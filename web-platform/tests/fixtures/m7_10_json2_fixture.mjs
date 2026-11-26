// FIXTURE ONLY — M7.10 offline BLAST JSON2 test data.
// These objects were hand-written for unit tests. They are NOT a live NCBI
// response, NOT a mock provider and NOT scientific evidence. No test using
// this file contacts NCBI/9Router; every fetch is stubbed or absent.
// Shape follows the documented NCBI JSON2 structure:
//   BlastOutput2.report.results.search.{query_title,query_len,hits[].description[],hits[].hsps[]}

const Q40 = "ACGT".repeat(10); // 40 nt, fixture only
const M40 = "|".repeat(40); // 40 chars, fixture only
const S40 = "ACGT".repeat(7) + "TCGT" + "ACGT".repeat(2); // 40 nt, fixture only

export const JSON2_FIXTURE = {
  BlastOutput2: {
    program: "blastn",
    version: "BLASTN fixture",
    reference: "FIXTURE ONLY - not from NCBI",
    report: {
      program: "blastn",
      params: {
        database: "rRNA_typestrains/16S_ribosomal_RNA",
        program: "blastn",
        expect: "1e-10",
        hitlist_size: "50"
      },
      results: {
        search: {
          query_title: "fixture_query_1 16S isolate",
          query_len: 40,
          hits: [
            {
              num: 1,
              description: [{
                id: "NR_074666.1",
                accession: "NR_074666.1",
                title: "Francisella tularensis subsp. isolate fixture",
                organism: "Francisella tularensis",
                taxid: 1234,
                length: 1500
              }],
              hsps: [
                {
                  num: 1,
                  score: 400,
                  bit_score: 200,
                  evalue: "1e-50",
                  identity: "97.5",
                  positive: 98,
                  gaps: 0,
                  gap: 0,
                  length: 40,
                  qstart: 1,
                  qend: 40,
                  sstart: 1,
                  send: 40,
                  nident: 39,
                  slen: 1500,
                  qcovs: 100,
                  qseq: Q40,
                  sseq: S40,
                  midline: M40
                },
                {
                  num: 2,
                  score: 240,
                  bit_score: 120,
                  evalue: "1e-20",
                  identity: "96",
                  length: 26,
                  qstart: 5,
                  qend: 30,
                  sstart: 40,
                  send: 15,
                  nident: 25,
                  slen: 1500,
                  qcovs: 70,
                  qseq: Q40.slice(4, 30),
                  sseq: S40.slice(14, 40).split("").reverse().join(""),
                  midline: M40.slice(4, 30)
                }
              ]
            },
            {
              num: 2,
              description: [{ id: "WP_000002.1", title: "uncultured bacterium fixture" }],
              hsps: [{
                num: 1,
                bit_score: 100,
                evalue: "1e-10",
                identity: "95",
                length: 20,
                qstart: 1,
                qend: 20,
                sstart: 1,
                send: 20
              }]
            },
            {
              num: 3,
              description: [{
                accession: "AY123456.1",
                title: "Bacillus subtilis fixture",
                organism: "Bacillus subtilis",
                taxid: [1423, 999],
                length: 2000
              }],
              hsps: [{
                num: 1,
                bit_score: 90,
                evalue: "1e-5",
                identity: "90",
                length: 11,
                qstart: 10,
                qend: 20,
                sstart: 1,
                send: 11
              }]
            }
          ]
        }
      }
    }
  }
};

export const JSON2_FIXTURE_TEXT = JSON.stringify(JSON2_FIXTURE);

// FIXTURE: complete search, zero hits (ThereAreHits=no equivalent in JSON2).
export const JSON2_NO_HITS_FIXTURE_TEXT = JSON.stringify({
  BlastOutput2: {
    program: "blastn",
    report: {
      params: { database: "rRNA_typestrains/16S_ribosomal_RNA", program: "blastn" },
      results: {
        search: {
          query_title: "fixture_no_hits",
          query_len: 40,
          hits: []
        }
      }
    }
  }
});

// FIXTURE: parseable JSON but no report.results.search object.
export const JSON2_MALFORMED_FIXTURE_TEXT = JSON.stringify({ BlastOutput2: { report: {} } });

// FIXTURE: not even valid JSON.
export const JSON2_INVALID_JSON_FIXTURE_TEXT = "{ this is not json";
