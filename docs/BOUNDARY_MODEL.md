# Boundary model

Task data stays inside the zones below. Files under src/app and src/components import none of these zones and never read a secret environment name.

- zone: src/features/tasks
- zone: src/server

src/features/tasks holds task records for the dashboard. src/server is the only folder that may later call a provider. No provider module is on, so src/server has no entry file yet. UI files never import a database client.
