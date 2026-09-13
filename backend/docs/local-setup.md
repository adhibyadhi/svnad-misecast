# MiseCast Local Setup

## Requirements

- Node.js compatible with the installed dependencies and --env-file
- npm
- A running local MongoDB server
- The project dependencies installed from package-lock.json

Install dependencies after cloning with:

    npm ci

## Environment configuration

Create .env in the project root using .env.example as a reference.

Required settings:

| Variable            | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| HOST                | Local listening address: 127.0.0.1 or ::1           |
| PORT                | Express listening port                              |
| MONGODB_URI         | MongoDB connection string, including database name  |
| RESTAURANT_ID       | Identifier matching source sales and inventory data |
| RESTAURANT_TIMEZONE | Restaurant timezone, such as Australia/Sydney       |

Replace example values with the restaurant's actual settings.

Do not commit .env. Commit .env.example without credentials.

The application uses Node's --env-file option.
It does not require dotenv.

Existing process environment variables take precedence over .env.

## Starting the application

Run from the project root:

    npm start

This executes:

    node --env-file=.env server.js

The application connects to MongoDB and initializes business-model indexes
before accepting HTTP requests.

Open the exact address printed in the terminal.
With HOST=127.0.0.1, use 127.0.0.1 rather than localhost.

Stop the application with Control + C.

## Network behaviour

The application, MongoDB and model runtime run locally.

Outbound network connections to external APIs are allowed.

Bootstrap CSS and JavaScript are served from the locally installed
Bootstrap package. No Bootstrap CDN is required.

External context providers and model integration are not implemented yet.

## Request protection

Browser requests that change data must use the application's own origin.

Scripts and Postman requests without an Origin header must include:

    X-MiseCast-Request: 1

This header is an explicit client marker, not a password or API key.

The application does not enable cross-origin browser access.
Request-origin protection does not provide user authentication.

## Available checks

Document validation, without MongoDB:

    npm run check:models

Index checks against a generated temporary local database:

    npm run check:indexes

The index script removes its own temporary database after the checks.
It does not use the application database.

HTTP application checks, with the application running:

    npm run check:app

## Current functionality

- Validated environment configuration
- MongoDB connection and business-model index initialization
- Shared EJS navigation and error pages
- Locally served Bootstrap
- JSON error responses for API paths
- Request-origin protection
- Shared request, pagination, business-date and decimal helpers
- Graceful application shutdown

Imports, operational screens, external context, forecasts and analytics
will be implemented in later commits.

## Remaining configuration

Coordinates, service boundaries, provider credentials, model paths
and import-specific upload limits will be added with their features.
The default request-body limit is currently 1 MiB.

## Troubleshooting

### Restaurant ID placeholder error

Replace RESTAURANT_ID in .env with the identifier present in source data.
Do not remove the validation merely to accept the placeholder.

### Database connection failure

Check that MongoDB is running and MONGODB_URI is correct.

### Address already in use

Stop the existing application process or choose another PORT.

### Request rejected with HTTP 403

Use the exact configured host and port.
For script mutations without Origin, include X-MiseCast-Request: 1.

### Bootstrap styling is missing

Run npm ci and restart the application.
Check that the local Bootstrap CSS URL returns successfully.

### Missing module or view

Confirm the file exists at the exact path used by its import or include.
Save editor changes before restarting.

## MongoDB configuration from Commit 3 onward

The application and import worker now use the local replica set:

    MONGODB_URI=mongodb://localhost:27018/misecast?replicaSet=misecast-rs

Start it from the project root:

    mongod --dbpath "$PWD/local-data/mongodb-rs" --port 27018 --bind_ip localhost --replSet misecast-rs

Keep that terminal running while using the application.

The data directory persists between restarts and is excluded from Git.
Replica-set initialization is performed once, not on every startup.

The original standalone instance on port 27017 is separate.
Its data is not automatically copied into the replica set.

See docs/import-guide.md for uploads, worker execution and recovery.
