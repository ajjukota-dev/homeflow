// Deployment shell for the HomeFlow API Lambda.
// At deploy time this is replaced by the bundled handlers from services/ (the same
// domain code we run locally under Express). Kept minimal so `cdk synth` needs no
// bundler and validates cleanly.
export const handler = async () => ({
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ok: true, note: "HomeFlow API — domain handlers wired at deploy" }),
});
