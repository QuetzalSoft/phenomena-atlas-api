import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import * as shapefile from "shapefile";

// Where the initial partition comes from. See docs/adr/0010-region-data-sources.md in the
// system repository. Nothing downloaded here is committed: IMEPLAN publishes no license.

/** The four municipalities of the metropolitan area, by INEGI municipality key within Jalisco. */
export const metropolitanMunicipalities = ["039", "098", "101", "120"] as const;

/** IMEPLAN numbers municipalities its own way. Its code for each INEGI key above. */
export const imeplanMunicipalityCodes: Record<string, number> = { "14039": 41, "14098": 99, "14101": 102, "14120": 120 };

export const defaultSourceUrls = {
  /** INEGI Marco Geoestadístico, census 2020 edition, Jalisco: municipalities and blocks. */
  marcoGeoestadistico:
    "https://www.inegi.org.mx/contenidos/productos/prod_serv/contenidos/espanol/bvinegi/productos/geografia/marcogeo/889463807469/14_jalisco.zip",
  /** INEGI Censo de Población y Vivienda 2020, results by urban block, Jalisco. */
  census:
    "https://www.inegi.org.mx/contenidos/programas/ccpv/2020/datosabiertos/ageb_manzana/ageb_mza_urbana_14_cpv2020_csv.zip",
  /** IMEPLAN SIGmetro colonias, limited to the four municipalities, in WGS 84. */
  colonias:
    "https://geoserver.imeplan.mx/geoserver/sigmetro/wfs?service=WFS&version=2.0.0&request=GetFeature" +
    "&typeNames=sigmetro:ColoniaJalisco&outputFormat=application/json&srsName=EPSG:4326" +
    `&CQL_FILTER=municipio%20IN%20(${Object.values(imeplanMunicipalityCodes).join(",")})`,
};

/** INEGI publishes in Mexico ITRF2008 / LCC. */
export const inegiSrid = 6372;

export type PolygonalGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export interface SourceMunicipality {
  /** Five-digit INEGI key, such as 14039. */
  code: string;
  name: string;
  geometry: PolygonalGeometry;
}

export interface SourceColonia {
  name: string;
  /** The municipality as IMEPLAN numbers it. Only used to report disagreements. */
  imeplanMunicipality: number;
  geometry: PolygonalGeometry;
}

export interface SourceBlock {
  /** INEGI's 16-digit block key. */
  key: string;
  geometry: PolygonalGeometry;
}

/** Everything the initial partition is built from, already read and parsed. */
export interface InitialPartitionSources {
  /** The spatial reference of the municipality and block geometries. Colonias are WGS 84. */
  inegiSrid: number;
  municipalities: SourceMunicipality[];
  colonias: SourceColonia[];
  blocks: SourceBlock[];
  /** Population by block key. Null where the census suppressed the value. */
  blockPopulation: Map<string, number | null>;
  /** The census total of each municipality, by five-digit key, to compare the result with. */
  municipalityPopulation: Map<string, number>;
}

/**
 * Downloads every source into `cacheDirectory`, reusing what is already there, and reads
 * the parts the initial partition needs.
 */
export async function fetchInitialPartitionSources(
  cacheDirectory: string,
  urls = defaultSourceUrls,
  log: (message: string) => void = () => {},
): Promise<InitialPartitionSources> {
  await mkdir(cacheDirectory, { recursive: true });
  const [marco, census, colonias] = [
    join(cacheDirectory, "marco-geoestadistico-2020-14.zip"),
    join(cacheDirectory, "censo-2020-manzanas-14.zip"),
    join(cacheDirectory, "imeplan-colonias.geojson"),
  ];
  await download(urls.marcoGeoestadistico, marco, log);
  await download(urls.census, census, log);
  await download(urls.colonias, colonias, log);

  log("Reading the sources.");
  const shapes = unzipSync(await readFile(marco), {
    filter: (file) => /conjunto_de_datos\/14(mun|m)\.(shp|dbf)$/.test(file.name),
  });
  const layer = (name: string) => {
    const shp = shapes[`conjunto_de_datos/${name}.shp`];
    const dbf = shapes[`conjunto_de_datos/${name}.dbf`];
    if (!shp || !dbf) {
      throw new Error(`The Marco Geoestadístico file has no layer ${name}.`);
    }
    return { shp, dbf };
  };

  const municipalities = (await readShapefile(layer("14mun")))
    .filter((feature) => isMetropolitan(feature.properties.CVE_MUN))
    .map((feature) => ({ code: text(feature.properties.CVEGEO), name: text(feature.properties.NOMGEO), geometry: feature.geometry }));
  const blocks = (await readShapefile(layer("14m")))
    .filter((feature) => isMetropolitan(feature.properties.CVE_MUN))
    .map((feature) => ({ key: text(feature.properties.CVEGEO), geometry: feature.geometry }));

  const [csv] = Object.values(unzipSync(await readFile(census), { filter: (file) => isCensusTable(file.name) }));
  if (!csv) {
    throw new Error("The census file has no results table.");
  }
  const { blockPopulation, municipalityPopulation } = parseCensusTable(new TextDecoder("utf-8").decode(csv));

  return {
    inegiSrid,
    municipalities,
    colonias: parseColonias(JSON.parse(await readFile(colonias, "utf8")) as unknown),
    blocks,
    blockPopulation,
    municipalityPopulation,
  };
}

/** Deletes the downloaded sources, so the next load fetches them again. */
export async function clearSourceCache(cacheDirectory: string): Promise<void> {
  await rm(cacheDirectory, { recursive: true, force: true });
}

async function download(url: string, path: string, log: (message: string) => void): Promise<void> {
  if (await exists(path)) {
    log(`Using the cached ${path}.`);
    return;
  }
  log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Downloading ${url} failed: ${response.status} ${response.statusText}`);
  }
  // Written only once complete, so an interrupted download is never mistaken for a cached file.
  await writeFile(path, new Uint8Array(await response.arrayBuffer()));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

interface ShapefileFeature {
  geometry: PolygonalGeometry;
  properties: Record<string, unknown>;
}

async function readShapefile({ shp, dbf }: { shp: Uint8Array; dbf: Uint8Array }): Promise<ShapefileFeature[]> {
  // INEGI's attribute tables are Latin-1, as their .cpg files say.
  const source = await shapefile.open(toArrayBuffer(shp), toArrayBuffer(dbf), { encoding: "iso-8859-1" });
  const features: ShapefileFeature[] = [];
  for (let next = await source.read(); !next.done; next = await source.read()) {
    const { geometry, properties } = next.value;
    if (geometry?.type === "Polygon" || geometry?.type === "MultiPolygon") {
      features.push({ geometry: geometry, properties: properties as Record<string, unknown> });
    }
  }
  return features;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isMetropolitan(municipality: unknown): boolean {
  return (metropolitanMunicipalities as readonly unknown[]).includes(municipality);
}

function isCensusTable(name: string): boolean {
  return /conjunto_de_datos\/conjunto_de_datos_ageb_urbana_\d+_cpv2020\.csv$/.test(name);
}

function text(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`Expected text in a source attribute, got ${JSON.stringify(value)}.`);
  }
  return value;
}

/** Reads IMEPLAN's GeoJSON. Exported for tests. */
export function parseColonias(json: unknown): SourceColonia[] {
  const features = (json as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    throw new Error("The colonias source is not a GeoJSON FeatureCollection.");
  }
  return features.flatMap((feature: { geometry?: PolygonalGeometry | null; properties?: Record<string, unknown> }) => {
    const { geometry, properties } = feature;
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") || !properties) {
      return [];
    }
    const name = typeof properties.nombre === "string" ? properties.nombre.trim() : "";
    return [{ name: name || "Unnamed colonia", imeplanMunicipality: Number(properties.municipio), geometry }];
  });
}

/**
 * Reads INEGI's census table by block. Rows with key parts made of zeros are totals: the
 * municipality totals are kept for comparison, the rest are skipped. Exported for tests.
 */
export function parseCensusTable(csv: string): {
  blockPopulation: Map<string, number | null>;
  municipalityPopulation: Map<string, number>;
} {
  const lines = csv.split(/\r?\n/).filter((line) => line.length > 0);
  const header = splitCsvLine(lines[0] ?? "");
  const column = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) {
      throw new Error(`The census table has no ${name} column.`);
    }
    return index;
  };
  const [entity, municipality, locality, ageb, block, population] = ["ENTIDAD", "MUN", "LOC", "AGEB", "MZA", "POBTOT"].map(column) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  const blockPopulation = new Map<string, number | null>();
  const municipalityPopulation = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const mun = cells[municipality] ?? "";
    if (!isMetropolitan(mun)) {
      continue;
    }
    const [loc, agebKey, mza, total] = [cells[locality], cells[ageb], cells[block], cells[population]];
    const code = `${cells[entity]}${mun}`;
    if (loc === "0000" && agebKey === "0000" && mza === "000") {
      municipalityPopulation.set(code, Number(total));
    } else if (loc !== "0000" && agebKey !== "0000" && mza !== "000") {
      blockPopulation.set(`${code}${loc}${agebKey}${mza}`, total === "*" || total === undefined ? null : Number(total));
    }
  }
  return { blockPopulation, municipalityPopulation };
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}
