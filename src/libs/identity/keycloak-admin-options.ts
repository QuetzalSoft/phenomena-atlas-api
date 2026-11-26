/** How the API reaches Keycloak to edit accounts, with a service account of its own. */
export interface KeycloakAdminOptions {
  /** Where the service account gets its token: the realm's `token` endpoint. */
  tokenUrl: string;
  /** The realm's admin API, up to and including the realm: `.../admin/realms/<realm>`. */
  adminUrl: string;
  clientId: string;
  /** Comes from deployment configuration, never from the repository. */
  clientSecret: string;
}

/** Injection token for the `KeycloakAdminOptions`. */
export const KEYCLOAK_ADMIN_OPTIONS = Symbol("KEYCLOAK_ADMIN_OPTIONS");
