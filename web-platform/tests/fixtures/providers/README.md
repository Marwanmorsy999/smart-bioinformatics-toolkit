# MOCK provider fixtures

Every file in this directory is **MOCK / synthetic test data**. None of it was
captured from a live provider, none of it contains real credentials, real tool
or workflow IDs, real model names, real quotas, or real endpoints. Tests must
derive expected values from the fixture itself (never from a hardcoded ID) and
must serve these payloads through an injected `fetch`.

- `galaxy/` — synthetic `/api/*` responses. Tool and workflow identifiers are
  arbitrary `mock.*` strings; the quota numbers are invented *for the fixture
  only* and are never used as platform defaults.
- `smartsbio/` — synthetic `/v1/*` responses. The smarts.bio API shape was
  grounded in the published docs (`https://www.smarts.bio/llms.txt`,
  `/docs/reference/*`), but the content here is fabricated.
- `ninerouter/` — synthetic OpenAI-compatible `/v1/*` responses. Model IDs and
  usage numbers are fabricated.

No fixture is used at runtime by adapters; they exist only for `node --test`.
