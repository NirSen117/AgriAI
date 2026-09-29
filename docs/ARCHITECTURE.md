# Architecture

The backend owns secrets, provider selection, normalization, validation, and
agricultural reasoning. The frontend consumes normalized API contracts and
never calls third-party services directly.

Each external system is behind a small provider protocol. A configured
provider can fail without taking down the dashboard: the service returns a
mock or cached observation and reports provider status separately. Deterministic
calculations (rainfall risk, field-health bands, and regenerative rule
selection) happen before optional AI generation.

The interoperability layer converts state-specific records into a common
`AgricultureRecord`, validates required fields, and exposes data-quality
metadata. GeoJSON is used for boundaries so a map provider can be swapped
later.
