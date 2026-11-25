# phenomena-atlas-api
API for the phenomena atlas project

### Updating the Keycloak realm

In dev mode Keycloak keeps its data inside the container, and the realm file
(`keycloak/phenomena-atlas-realm.json`) is only imported when the container is
created. After changing that file, recreate the container to apply it:

    docker compose up -d --force-recreate keycloak

Changes made in the Keycloak admin console are lost when the container is
recreated, so persist any realm change in the JSON file.

Self-service registration is enabled (`registrationAllowed`), so the login
page shows a "Register" link. Email verification (`verifyEmail`) is disabled
for local development because it requires an SMTP server.

### Editing account details

The API edits an account's first name, last name and email in Keycloak, with a
service account (the client `phenomena-atlas-account-admin` in the realm file).
It can only find and update users. See
`docs/adr/0014-account-details-are-edited-through-the-api.md` in the root
repository.

The API needs four settings, in `.env.example`: `KEYCLOAK_TOKEN_URL`,
`KEYCLOAK_ADMIN_URL`, `KEYCLOAK_ADMIN_CLIENT_ID` and `KEYCLOAK_ADMIN_CLIENT_SECRET`.
The secret in `.env.example` and in the realm file is for development only.
Deployments must set their own secret and give the same one to that client in
Keycloak. The API does not start without these settings.

If you already have a local `.env`, add them, then recreate Keycloak (see above)
so the realm has the new client.
