// FIXTURE ONLY — M7.11 offline CMD=Put response fixtures.
//
// The QBlastInfoBegin/QBlastInfoEnd shapes below follow the documented NCBI
// BLAST Common URL API and the layout recorded in docs/evidence (comment
// wrapped, tab-separated RID / RTOE lines). Every value here is hand-written
// and synthetic. These strings are NOT live NCBI responses, NOT a mock
// provider and NOT scientific evidence. No test importing this file contacts
// NCBI: every fetch is stubbed and no CMD=Put is ever transmitted.

export const FIXTURE_RID = "FIXTURE01";
export const FIXTURE_RID_B = "FIXTURE02";
export const FIXTURE_RTOE = 21;

export const DOCUMENTED_QBLAST_BLOCK = [
  "QBlastInfoBegin",
  "\tRID = FIXTURE01",
  "\tRTOE = 21",
  "QBlastInfoEnd"
].join("\n");

// Comment-wrapped form as seen in genuine NCBI CMD=Get pages: the markers sit
// inside an HTML comment while the inner lines keep their own line breaks.
export const HTML_COMMENT_WRAPPED_QBLAST = [
  '<html><body><p id="qb"><!--',
  "QBlastInfoBegin",
  "    RID = FIXTURE01",
  "    RTOE = 21",
  "QBlastInfoEnd",
  "--></p></body></html>"
].join("\n");

// CRLF plus mixed tabs/spaces around the separators.
export const CRLF_QBLAST = [
  "<p><!--",
  "QBlastInfoBegin",
  "  RID  :  FIXTURE01  ",
  "  RTOE  :  21  ",
  "QBlastInfoEnd",
  "--></p>"
].join("\r\n");

// Full HTML document wrapper with the classic hidden form fields plus the
// visible "Request ID" table cell.
export const FULL_HTML_DOCUMENT = [
  "<!DOCTYPE html>",
  '<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">',
  "<title>NCBI Blast:</title></head><body>",
  '<table id="statInfo"><tr><td>Request ID</td><td> <b>FIXTURE01</b></td></tr></table>',
  '<form><input name="RID" type="hidden" value="FIXTURE01">',
  '<input name="RTOE" type="hidden" value="21"></form>',
  "</body></html>"
].join("\n");

// Legacy attribute order: value before name, single quotes, extra attributes.
export const REVERSED_ATTRIBUTES = [
  '<input type=\'hidden\' value=\'FIXTURE01\' name=\'RID\'>',
  '<input value="21" name="RTOE" type="hidden">'
].join("\n");

export const NCBI_ERROR_PAGE = [
  "<html><body>",
  '<p class="usa-alert-text">There was a problem with the search.</p>',
  "<p class=\"usa-alert-text\">Error: No alias or index file found for nucleotide database [16S_ribosomal_RNA] in search path [/blast/db].</p>",
  "</body></html>"
].join("\n");

export const EMPTY_BODY = "";

export const RATE_LIMIT_BODY = [
  "<html><head><title>429 Too Many Requests</title></head>",
  "<body><p>Too Many Requests — rate limit exceeded. Retry after 60 seconds.</p></body></html>"
].join("\n");

export const PROXY_CDN_ERROR_BODY = [
  "<html><head><title>502 Bad Gateway</title></head>",
  "<body><h1>502 Bad Gateway</h1><p>cloudflare nginx upstream connect error</p></body></html>"
].join("\n");

// A normal 2xx HTML page with no QBlastInfo block and no RID at all.
export const UNEXPECTED_HTML_BODY = [
  "<!DOCTYPE html>",
  "<html><head><title>NCBI BLAST</title></head>",
  "<body><h1>BLAST</h1><p>Choose a program to begin.</p></body></html>"
].join("\n");

export const UNEXPECTED_JSON_BODY = '{"error":"unknown command","status":200}';

export const MALFORMED_RID_BODY = "RID = !!!BAD-RID!!!\nRTOE = 21";

export const MALFORMED_RTOE_BODY = "QBlastInfoBegin\n\tRID = FIXTURE02\n\tRTOE = soon\nQBlastInfoEnd";

// A syntactically valid RID alongside provider error text: accepted but
// ambiguous, so diagnostics must be captured even though a job id exists.
export const RID_WITH_ERROR_PAGE = [
  "QBlastInfoBegin",
  "\tRID = FIXTURE01",
  "\tRTOE = 21",
  "QBlastInfoEnd",
  '<p class="usa-alert-text">Error: No alias or index file found for nucleotide database.</p>'
].join("\n");

// Documented status block shape, but it carries no CMD=Put RID.
export const QBLAST_STATUS_ONLY_BODY = [
  "<!--",
  "QBlastInfoBegin",
  "\tStatus=WAITING",
  "QBlastInfoEnd",
  "-->"
].join("\n");

// Hostile body used only to prove diagnostic redaction. All values are fake.
export const SECRET_LADEN_BODY = [
  "<html><body>",
  "<p>consent_0123456789abcdef0123456789abcdef</p>",
  "<p>api_key=SECRET_FAKE_KEY_VALUE_1234567890</p>",
  "<p>Authorization: Bearer FAKE_TOKEN_9876543210</p>",
  "<p>contact: researcher.fake@example.org</p>",
  "<p>QUERY=>seq1 16S fixture\nACGTACGTACGTACGTACGTACGTACGTACGT</p>",
  "<p>?token=FAKE_QUERY_TOKEN_VALUE_1234567890</p>",
  "</body></html>"
].join("\n");
