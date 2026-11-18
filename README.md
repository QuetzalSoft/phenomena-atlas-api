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