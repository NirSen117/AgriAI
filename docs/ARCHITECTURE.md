# Architecture

The backend owns secrets, provider selection, normalization, validation, and
agricultural reasoning. The frontend consumes normalized API contracts and
never calls third-party services directly.

Each external system is behind a small provider protocol. A configured
provider can fail without taking down the dashboard: the service returns a
mock or cached observation and reports provider status separately. Deterministic
calculations (rainfall risk, field-health bands, and regenerative rule
selection) happen before optional AI generation.

The interoperability layer converts the signed-in farm profile and configured
provider observations into `AgroAIRecord/v1`, validates output with Pydantic,
and includes source, unit, timestamp, quality, and limitation metadata. Point
coordinates use GeoJSON longitude/latitude order. State-government datasets
are not connected yet; the API and UI state this directly rather than showing
simulated regional connectors as live integrations.
