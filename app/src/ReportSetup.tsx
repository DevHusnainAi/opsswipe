// Where a service's failure reports go and how to check they arrive: the URL and secret (shown once), a
// one-line test to run on the server, and for a Google Cloud VM the ready gcloud command to set them (on a VM,
// Railway or Render, OpsSwipe usually sets them itself: onVm).
// A report that never arrives (an app still holding an old secret) otherwise fails silently.
import { StyleSheet, Text, View } from 'react-native';
import { CopyRow } from './ui';
import type { Service } from './api';
import { c, radius, space, type } from './theme';

export function ReportSetup(
  { report, service, onVm = false }: { report: { url: string; secret: string }; service: Service; onVm?: boolean },
) {
  const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
  const body = '{"test":true,"method":"GET","path":"/","status":500}';
  const test = [
    `body=${q(body)}`,
    `sig=$(printf %s "$body" | openssl dgst -sha256 -hmac ${q(report.secret)} | sed 's/^.* //')`,
    `curl -sS -X POST ${q(report.url)} -H 'content-type: application/json' -H "x-opsswipe-signature: sha256=$sig" -d "$body"`,
  ].join('; ');
  const { project, zone, instance } = service.config;
  const gcloud = service.provider === 'gcp' && !onVm && project && zone && instance
    ? `gcloud compute instances add-metadata ${instance} --project ${project} --zone ${zone} --metadata ${q(`opsswipe-report-url=${report.url},report-secret=${report.secret}`)}`
    : null;
  return (
    <View style={styles.box}>
      {onVm
        ? (
          <Text style={[type.caption, { color: c.green }]}>
            {service.provider !== 'gcp'
              ? `Already on ${service.provider === 'railway' ? 'Railway' : 'Render'}: OpsSwipe set OPSSWIPE_REPORT_URL and REPORT_SECRET on the service, and it is redeploying with them. Nothing to copy.`
              : `Already on ${instance}: OpsSwipe wrote the URL and secret onto the VM's metadata. An app that reads them from there (like the demo) needs nothing else; one that reads environment variables needs the values below.`}
          </Text>
        )
        : (
          <Text style={[type.caption, { color: c.amber }]}>
            Shown only once. Reports are optional for alerts, and needed for Revert and Fix with AI (CI replays those
            requests).
          </Text>
        )}
      <CopyRow label="OPSSWIPE_REPORT_URL" value={report.url} />
      <CopyRow label="REPORT_SECRET" value={report.secret} />
      {gcloud && <CopyRow label="On Google Cloud: set both on the VM (then restart your app)" value={gcloud} lines={6} />}
      <CopyRow label="Snippet (Express)" value={REPORT_SNIPPET} lines={14} />
      <CopyRow label="Test it: run on your server, then look for “Last report … (test)” here" value={test} lines={6} />
      <Text style={type.caption}>
        Set GIT_SHA to the deployed commit so a revert or AI fix targets exactly the release that broke. Other stacks:
        sign the JSON body with HMAC-SHA256 the same way (see Failure reports in the README).
      </Text>
    </View>
  );
}

const REPORT_SNIPPET = `// Express, Node 18+: report every 5xx to OpsSwipe (method, path, status only)
const { createHmac } = require('node:crypto');
app.use((req, res, next) => {
  res.on('finish', () => {
    const { OPSSWIPE_REPORT_URL: url, REPORT_SECRET: key, GIT_SHA } = process.env;
    if (res.statusCode < 500 || !url || !key) return;
    const body = JSON.stringify({ method: req.method, path: req.originalUrl, status: res.statusCode, release: GIT_SHA });
    const sig = 'sha256=' + createHmac('sha256', key).update(body).digest('hex');
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-opsswipe-signature': sig }, body }).catch(() => {});
  });
  next();
});`;

const styles = StyleSheet.create({
  box: { gap: space.sm, padding: space.md, borderRadius: radius.card, backgroundColor: c.surface },
});
