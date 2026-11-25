import type { Schemas } from "../../../libs/api/contract.js";
import { ContractHttpException } from "../../../libs/api/contract-http.exception.js";
import type { ProfileEdit } from "../domain/account.entity.js";

const names = ["firstName", "lastName"] as const;

/**
 * The request body as an edit, with the names trimmed. A name of only spaces passes the
 * contract's `minLength` but is blank, so it is refused the way the validator refuses an
 * empty one. The email needs no trimming: its format already refuses spaces.
 */
export function profileEditOf(body: Schemas["AccountProfile"]): ProfileEdit {
  const edit = { ...body, firstName: body.firstName.trim(), lastName: body.lastName.trim() };
  const blank = names.filter((name) => edit[name] === "");
  if (blank.length > 0) {
    throw new ContractHttpException(400, "invalid_request", `request/body/${blank[0]} must not be blank`, {
      errors: blank.map((name) => ({ path: `/body/${name}`, message: "must not be blank" })),
    });
  }
  return edit;
}
