#!/usr/bin/env node
/**
 * Pull the latest successful scan's full report from Celery's Redis backend
 * and render it as a standalone HTML file on your Desktop. Mirrors the mobile
 * PDF template so you can view the same content in any browser, print it,
 * or save as PDF via Cmd+P → "Save as PDF".
 *
 * Usage:
 *   node scripts/render-latest-report.mjs            # latest
 *   node scripts/render-latest-report.mjs <jobId>    # specific job
 */
// Use the ioredis package already installed in backend/node_modules.
import Redis from '/Users/shubhamyeljale/Desktop/CROPSETU2/backend/node_modules/ioredis/built/index.js';
import { writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function main() {
  const argJobId = process.argv[2];
  const client = new Redis({ host: 'localhost', port: 6379, db: 1 });

  let jobId = argJobId;
  if (!jobId) {
    const keys = await client.keys('celery-task-meta-*');
    if (!keys.length) {
      console.error('No Celery results in Redis. Run a scan first.');
      process.exit(1);
    }
    // Newest by inspecting each value's date_done
    let newest = null;
    for (const k of keys) {
      const raw = await client.get(k);
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);
        if (obj.status !== 'SUCCESS') continue;
        const ts = obj.date_done || '';
        if (!newest || ts > newest.ts) newest = { ts, obj, jobId: obj.task_id };
      } catch { /* skip */ }
    }
    if (!newest) { console.error('No SUCCESSful tasks in Redis.'); process.exit(1); }
    jobId = newest.jobId;
  }

  const raw = await client.get(`celery-task-meta-${jobId}`);
  await client.quit();
  if (!raw) { console.error(`No result for job ${jobId}`); process.exit(1); }

  const env = JSON.parse(raw);
  if (env.status !== 'SUCCESS') {
    console.error(`Job ${jobId} status=${env.status}`);
    process.exit(1);
  }
  const report = env.result;

  // ── Render ────────────────────────────────────────────────────────────────
  const fsp  = report.farmer_summary_page || {};
  const dgp  = report.detailed_guidance_page || {};
  const dsp  = report.dispensing_sheet_page || {};
  const anp  = report.annex_page || {};
  const meta = report.meta || {};
  const farm = fsp.farmer_details || report.farm || {};
  const dx   = fsp.disease_detected || report.disease || {};
  const weatherOutlook = report.weather_outlook || {};
  const treatment = report.treatment || {};
  const tokens   = meta.pipeline_token_usage || {};

  const dateStr = new Date(report.generated_at || Date.now()).toLocaleString('en-IN');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>CropSetu Report — ${esc(jobId.slice(0,8))}</title>
<style>
  @page{size:A4;margin:10mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Georgia,serif;color:#1c2526;background:#fefdf8;line-height:1.5;font-size:12px;padding:24px;max-width:900px;margin:0 auto}
  h1{font-size:24px;color:#0e3a26;border-bottom:2px solid #c9a961;padding-bottom:8px;margin-bottom:16px;font-weight:700}
  h2{font-size:16px;color:#0e3a26;text-transform:uppercase;letter-spacing:1.2px;margin:24px 0 10px;border-bottom:1px solid #c9a961;padding-bottom:6px}
  h3{font-size:13px;color:#1a5f3f;text-transform:uppercase;letter-spacing:.8px;margin:14px 0 6px}
  .hero{background:#fff;border:2px solid #1a5f3f;padding:16px 20px;display:flex;justify-content:space-between;gap:20px;margin-bottom:16px}
  .hero .left{flex:1}
  .hero .nm{font-size:22px;font-weight:700;color:#0e3a26}
  .hero .sci{font-style:italic;color:#6b7280;font-size:13px;margin-top:4px}
  .hero .conf{font-size:42px;font-weight:700;color:#1a5f3f;text-align:center;line-height:1}
  .hero .conf small{display:block;font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:1.5px;margin-top:4px}
  .kv{display:grid;grid-template-columns:140px 1fr;gap:6px 14px;font-size:11.5px;background:#fff;border:1px solid #d9cfb4;padding:10px 14px}
  .kv b{color:#6b7280;text-transform:uppercase;font-size:9.5px;letter-spacing:.7px;font-weight:600}
  .summary{background:#f1f7f3;border-left:4px solid #1a5f3f;padding:12px 16px;font-style:italic;margin:10px 0}
  ol,ul{padding-left:22px;margin:6px 0}
  ol li,ul li{margin:4px 0}
  .card{background:#fff;border:1px solid #d9cfb4;padding:12px 14px;margin:6px 0}
  .card .h{display:flex;justify-content:space-between;gap:10px;margin-bottom:6px}
  .card .h .nm{font-weight:700;color:#0e3a26;font-size:13px}
  .card .h .cost{color:#1a5f3f;font-weight:700;font-family:'Courier New',monospace}
  .card .meta{font-size:11px;color:#1c2526;margin-top:4px}
  .card .brands{font-size:10.5px;color:#6b7280;margin-top:6px}
  .twocol{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .twocol .col{background:#fff;border:1px solid #d9cfb4;padding:12px}
  .twocol .col.do h3{color:#0e3a26}
  .twocol .col.dont h3{color:#b8443e}
  table{width:100%;border-collapse:collapse;font-size:11px;margin:6px 0;background:#fff}
  th{background:#1a5f3f;color:#c9a961;text-align:left;padding:7px 9px;font-size:9.5px;letter-spacing:.8px;text-transform:uppercase}
  td{padding:7px 9px;border-bottom:1px dotted #d9cfb4;vertical-align:top}
  tr:nth-child(even) td{background:#fbf8ef}
  tr.primary td{background:#fdf6df;font-weight:600}
  .pill{display:inline-block;padding:3px 9px;font-size:9.5px;letter-spacing:1px;font-weight:700;border-radius:2px;text-transform:uppercase}
  .pill.PASSED{background:#cfe5d8;color:#0e3a26}
  .pill.WARNING{background:#fdf1d8;color:#d99a3a}
  .pill.FAILED{background:#f5e2e0;color:#b8443e}
  .pill.NA,.pill[class~="N/A"]{background:#eee;color:#6b7280}
  .va-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
  .va-pill{padding:4px 10px;font-size:11px;font-family:'Courier New',monospace}
  .va-pill.ok{background:#cfe5d8;color:#0e3a26}
  .va-pill.no{background:#f5e2e0;color:#b8443e}
  .va-pill.un{background:#fdf1d8;color:#d99a3a}
  .fc-row{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:6px}
  .fc-cell{background:#fff;border:1px solid #d9cfb4;padding:8px;text-align:center;font-size:10.5px}
  .fc-cell .d{font-weight:700;color:#0e3a26}
  .fc-cell .t{margin-top:2px;color:#1c2526;font-family:'Courier New',monospace}
  .fc-cell .r{margin-top:2px;color:#1a5f3f;font-size:10px;font-weight:600}
  .fc-cell .r.wet{color:#3a78b3}
  .meta-grid{background:#fff;border:1px solid #d9cfb4;padding:12px 16px;font-size:11.5px;display:grid;grid-template-columns:repeat(2,1fr);gap:6px 24px}
  .meta-grid b{color:#6b7280;text-transform:uppercase;font-size:9.5px;letter-spacing:.7px;font-weight:600;display:inline-block;min-width:130px}
  .meta-grid .mono{font-family:'Courier New',monospace;font-size:10.5px}
  footer{margin-top:30px;padding-top:14px;border-top:2px solid #1a5f3f;color:#6b7280;font-size:10.5px;text-align:center;line-height:1.6}
</style></head>
<body>
  <h1>CropSetu AI — Crop Disease Diagnostic Report</h1>
  <div style="font-size:11px;color:#6b7280;margin-bottom:16px">
    Generated: ${esc(dateStr)} · Job ID: <code>${esc(jobId)}</code> · Pipeline: ${esc((meta.pipeline_seconds || 0).toFixed?.(1) || meta.pipeline_seconds || '?')}s
  </div>

  <h2>1 · Primary Diagnosis</h2>
  <div class="hero">
    <div class="left">
      <div class="nm">${esc(dx.name_common || 'Unknown')}</div>
      <div class="sci">${esc(dx.name_scientific || '')}</div>
      <div style="margin-top:10px;font-size:11.5px">
        Severity: <b>${esc((dx.severity || meta.severity || '—').toUpperCase())}</b> &nbsp;·&nbsp;
        Pathogen: <b>${esc(dx.pathogen_label || dx.pathogen_type || '—')}</b> &nbsp;·&nbsp;
        Spread risk: <b>${esc(dx.spread_risk || '—')}</b>
      </div>
      ${dx.description ? `<div style="margin-top:10px;font-size:11.5px;line-height:1.55">${esc(dx.description)}</div>` : ''}
    </div>
    <div>
      <div class="conf">${dx.confidence_pct || Math.round((meta.confidence_score || 0) * 100)}%<small>Confidence (${esc(dx.confidence_tier || meta.confidence_tier || '')})</small></div>
    </div>
  </div>

  <h2>2 · Farmer Summary</h2>
  <div class="summary">${esc(fsp.farmer_summary || report.farmer_summary || '')}</div>

  <h2>3 · Field & Crop Context</h2>
  <div class="kv">
    <b>Crop</b><span>${esc(farm.crop || '—')}${farm.variety ? ` (${esc(farm.variety)})` : ''}</span>
    <b>Growth stage</b><span>${esc(farm.growth_stage || '—')}</span>
    <b>Location</b><span>${esc(farm.district || '')}${farm.state ? `, ${esc(farm.state)}` : ''}</span>
    <b>Farm size</b><span>${esc(farm.farm_size_acres || '—')} acres</span>
    <b>Affected area</b><span>${esc(farm.affected_area || '—')}</span>
    <b>GPS</b><span>${esc(farm.gps || '—')}</span>
  </div>

  ${Array.isArray(meta.differentials) && meta.differentials.length > 0 ? `
  <h2>4 · Differential Diagnoses (Ruled In)</h2>
  ${meta.differentials.map(d => `<div class="card">
    <div class="h"><div class="nm">${esc(d.disease || '')}</div><div class="cost">${Math.round((d.probability || 0) * 100)}%</div></div>
    <div class="meta"><b>Distinguishing:</b> ${esc(d.distinguishing_feature || d.reason || '')}</div>
  </div>`).join('')}` : ''}

  ${Array.isArray(report.causes) && report.causes.length > 0 ? `
  <h2>5 · Etiology — Why This Happened</h2>
  <ul>${report.causes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}

  ${treatment.immediate?.length > 0 ? `
  <h2>6 · Immediate Actions</h2>
  <ol>${treatment.immediate.map(a => `<li>${esc(a)}</li>`).join('')}</ol>` : ''}

  ${treatment.biological?.length > 0 ? `
  <h2>7 · Biological &amp; Organic Treatment</h2>
  ${treatment.biological.map(b => `<div class="card">
    <div class="h">
      <div class="nm">${esc(b.agent || b.product || '')}${b.type ? ` <span style="font-weight:400;color:#6b7280;font-style:italic">(${esc(b.type)})</span>` : ''}</div>
      ${b.cost_estimate_inr_per_acre ? `<div class="cost">₹ ${esc(b.cost_estimate_inr_per_acre)}/acre</div>` : ''}
    </div>
    <div class="meta">
      ${b.dosage ? `<b>Dose:</b> ${esc(b.dosage)} &nbsp;·&nbsp; ` : ''}
      ${b.dosage_per_acre ? `<b>Per acre:</b> ${esc(b.dosage_per_acre)} &nbsp;·&nbsp; ` : ''}
      ${b.phi_days != null ? `<b>PHI:</b> ${esc(b.phi_days)} days` : ''}
    </div>
    ${b.application_method ? `<div class="meta"><b>Apply:</b> ${esc(b.application_method)}</div>` : ''}
    ${Array.isArray(b.brands) && b.brands.length > 0 ? `<div class="brands"><b>Brands:</b> ${b.brands.map(br => `${esc(br.name)} (${esc(br.company || '')}, ${esc(br.pack || '')}${br.mrp_approx ? `, ~₹${br.mrp_approx}` : ''})`).join(' · ')}</div>` : ''}
  </div>`).join('')}` : ''}

  ${treatment.organic?.length > 0 ? `
  <h3>Organic alternatives</h3>
  ${treatment.organic.map(o => `<div class="card">
    <div class="h"><div class="nm">${esc(o.product || '')}</div>${o.cost_estimate_inr_per_acre ? `<div class="cost">₹ ${esc(o.cost_estimate_inr_per_acre)}/acre</div>` : ''}</div>
    <div class="meta">${o.dosage ? `<b>Dose:</b> ${esc(o.dosage)}` : ''}${o.application_method ? ` · ${esc(o.application_method)}` : ''}</div>
  </div>`).join('')}` : ''}

  ${treatment.fertilizer?.length > 0 ? `
  <h2>8 · Fertilizer &amp; Nutrition</h2>
  ${treatment.fertilizer.map(f => `<div class="card">
    <div class="h"><div class="nm">${esc(f.product || '')}${f.npk ? ` <span style="font-weight:400;color:#6b7280">NPK ${esc(f.npk)}</span>` : ''}</div></div>
    <div class="meta">${f.dosage_per_acre ? `<b>Per acre:</b> ${esc(f.dosage_per_acre)}` : ''}${f.timing ? ` · ${esc(f.timing)}` : ''}</div>
    ${f.reason ? `<div class="meta"><b>Why:</b> ${esc(f.reason)}</div>` : ''}
  </div>`).join('')}` : ''}

  ${Array.isArray(treatment.cultural) && treatment.cultural.length > 0 ? `
  <h2>9 · Cultural Practices</h2>
  <ol>${treatment.cultural.map(c => `<li>${esc(c)}</li>`).join('')}</ol>` : ''}

  ${Array.isArray(treatment.preventive) && treatment.preventive.length > 0 ? `
  <h2>10 · Preventive Measures (Next Season)</h2>
  <ol>${treatment.preventive.map(p => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}

  ${dsp.products?.length > 0 ? `
  <h2>11 · Dispensing Sheet — What to Buy</h2>
  <table>
    <thead><tr><th>#</th><th>Product</th><th>Brands</th><th>Qty</th><th>When</th><th>FRAC</th><th style="text-align:right">Est. Cost</th></tr></thead>
    <tbody>${dsp.products.map((p, i) => `<tr>
      <td>${i+1}</td><td><b>${esc(p.product || '')}</b>${p.active_ingredient ? `<br/><span style="color:#6b7280;font-style:italic;font-size:10px">${esc(p.active_ingredient)}</span>` : ''}</td>
      <td>${esc(p.brand_names || '—')}</td>
      <td>${esc(p.quantity_for_farm || '—')}</td>
      <td>${esc(p.when || '—')}</td>
      <td>${esc(p.frac_irac_group || '—')}</td>
      <td style="text-align:right;font-family:'Courier New',monospace;font-weight:700;color:#1a5f3f">${esc(p.est_price_inr || '—')}</td>
    </tr>`).join('')}</tbody>
  </table>
  ${dsp.total_estimated_cost_inr ? `<div style="margin-top:8px;background:#1a5f3f;color:#fff;padding:10px 14px;display:flex;justify-content:space-between;font-weight:700"><span>TOTAL ESTIMATED COST</span><span style="color:#c9a961;font-family:'Courier New',monospace">${esc(dsp.total_estimated_cost_inr)}</span></div>` : ''}
  ${dsp.ppe_checklist?.length > 0 ? `<div style="margin-top:10px"><b style="color:#6b7280;font-size:9.5px;text-transform:uppercase;letter-spacing:.8px">Required PPE:</b><div style="margin-top:4px">${dsp.ppe_checklist.map(p => `✓ ${esc(p)}`).join(' &nbsp; ')}</div></div>` : ''}` : ''}

  ${(dgp.safety_checklist?.do?.length || dgp.safety_checklist?.dont?.length) ? `
  <h2>12 · Applicator Safety</h2>
  <div class="twocol">
    <div class="col do"><h3>✓ Do</h3><ul>${(dgp.safety_checklist?.do || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
    <div class="col dont"><h3>✗ Don't</h3><ul>${(dgp.safety_checklist?.dont || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
  </div>` : ''}

  ${anp.compliance_audit?.length > 0 ? `
  <h2>13 · Regulatory Compliance Audit</h2>
  <table>
    <thead><tr><th>Check</th><th>Detail</th><th style="text-align:right">Status</th></tr></thead>
    <tbody>${anp.compliance_audit.map(c => `<tr>
      <td><b>${esc(c.check || '')}</b></td>
      <td>${esc(c.detail || '')}</td>
      <td style="text-align:right"><span class="pill ${esc((c.status || 'NA').replace('/',''))}">${esc(c.status || 'N/A')}</span></td>
    </tr>`).join('')}</tbody>
  </table>` : ''}

  ${anp.evidence_matrix?.diseases?.length > 0 ? `
  <h2>14 · Evidence Matrix — How the AI Reached This Verdict</h2>
  <table>
    <thead><tr><th>Disease</th><th style="text-align:right">Vision</th><th style="text-align:right">Env</th><th style="text-align:right">Symptom</th><th style="text-align:right">Fused</th></tr></thead>
    <tbody>${anp.evidence_matrix.diseases.map(e => `<tr class="${e.is_primary ? 'primary' : ''}">
      <td>${esc(e.disease || '')}${e.is_primary ? ' ★' : ''}</td>
      <td style="text-align:right;font-family:'Courier New',monospace">${e.vision_confidence != null ? Math.round(e.vision_confidence * 100) + '%' : '—'}</td>
      <td style="text-align:right">${esc(e.env_favorability || '—')}</td>
      <td style="text-align:right;font-family:'Courier New',monospace">${e.symptom_match != null ? Math.round(e.symptom_match * 100) + '%' : '—'}</td>
      <td style="text-align:right;font-family:'Courier New',monospace"><b>${e.fused_score != null ? Math.round(e.fused_score * 100) + '%' : '—'}</b></td>
    </tr>`).join('')}</tbody>
  </table>
  ${anp.evidence_matrix?.model_agreement ? `<div style="margin-top:8px;font-size:11px;color:#6b7280">Model perspective agreement: <b style="color:#0e3a26">${esc(anp.evidence_matrix.model_agreement)}</b></div>` : ''}
  ${Array.isArray(meta.confidence_penalties) && meta.confidence_penalties.length > 0 ? `<div style="margin-top:4px;font-size:11px;color:#6b7280">Penalties: ${meta.confidence_penalties.map(p => esc(p)).join('; ')}</div>` : ''}` : ''}

  ${meta.visual_audit && (meta.visual_audit.verified?.length || meta.visual_audit.falsified?.length) ? `
  <h2>15 · Visual Audit — Pixel-Level Verification</h2>
  <div style="font-size:11px;color:#6b7280;margin-bottom:8px">The AI's visual claims are cross-checked against an HSV histogram of actual pixels.</div>
  ${meta.visual_audit.verified?.length > 0 ? `<div style="margin-bottom:6px"><b style="font-size:10px;color:#6b7280;text-transform:uppercase">Verified:</b><div class="va-row">${meta.visual_audit.verified.map(c => `<span class="va-pill ok">✓ ${esc(c)}</span>`).join('')}</div></div>` : ''}
  ${meta.visual_audit.falsified?.length > 0 ? `<div style="margin-bottom:6px"><b style="font-size:10px;color:#6b7280;text-transform:uppercase">Falsified:</b><div class="va-row">${meta.visual_audit.falsified.map(c => `<span class="va-pill no">✗ ${esc(c)}</span>`).join('')}</div></div>` : ''}
  ${meta.visual_audit.score_penalty ? `<div style="margin-top:6px;color:#b8443e;font-size:11px">Confidence penalty applied: −${meta.visual_audit.score_penalty}</div>` : ''}` : ''}

  ${Array.isArray(weatherOutlook.raw_forecast) && weatherOutlook.raw_forecast.length > 0 ? `
  <h2>16 · 7-Day Weather Forecast</h2>
  <div class="fc-row">${weatherOutlook.raw_forecast.slice(0,7).map(f => {
    const d = (() => { try { return new Date(f.date).toLocaleDateString('en-IN', { weekday:'short', day:'numeric' }); } catch { return f.date; } })();
    return `<div class="fc-cell">
      <div class="d">${esc(d)}</div>
      <div class="t">${f.temp_min != null ? Math.round(f.temp_min) : '?'}–${f.temp_max != null ? Math.round(f.temp_max) : '?'}°C</div>
      <div class="r ${(f.precipitation_sum||0) > 1 ? 'wet' : ''}">${f.precipitation_sum != null ? f.precipitation_sum.toFixed(1)+'mm' : '—'}${f.precipitation_probability != null ? ` · ${f.precipitation_probability}%` : ''}</div>
    </div>`;
  }).join('')}</div>
  ${weatherOutlook.forecast_risk ? `<div style="margin-top:8px;font-style:italic;color:#6b7280">${esc(weatherOutlook.forecast_risk)}</div>` : ''}` : ''}

  <h2>17 · System Metadata</h2>
  <div class="meta-grid">
    ${meta.model_diagnose ? `<div><b>Diagnosis model</b> <span class="mono">${esc(meta.model_diagnose)}</span></div>` : ''}
    ${meta.model_treatment ? `<div><b>Treatment model</b> <span class="mono">${esc(meta.model_treatment)}</span></div>` : ''}
    ${meta.tier ? `<div><b>Tier</b> ${esc(meta.tier)}</div>` : ''}
    <div><b>Ensemble used</b> ${meta.ensemble_used ? `Yes (${(meta.ensemble_models || []).length})` : 'No'}</div>
    ${meta.ensemble_agreement ? `<div><b>Ensemble agreement</b> ${esc(meta.ensemble_agreement)}</div>` : ''}
    ${meta.pipeline_seconds ? `<div><b>Pipeline latency</b> ${meta.pipeline_seconds.toFixed(2)}s</div>` : ''}
    ${tokens.total_tokens ? `<div><b>Total tokens</b> ${tokens.total_tokens.toLocaleString()}</div>` : ''}
    ${tokens.total_cost_usd != null ? `<div><b>Total cost</b> $${tokens.total_cost_usd.toFixed(5)}</div>` : ''}
    <div style="grid-column:1/-1"><b>Report ID</b> <span class="mono">${esc(report.report_id || '—')}</span></div>
  </div>

  <footer>
    Generated by CropSetu AI · v${esc((anp.system_metadata || {}).version || '2.4.x')} ·
    Not a formal prescription — consult your nearest Krishi Vigyan Kendra for severe / unusual cases.
  </footer>
</body></html>`;

  // ── Write to Desktop ──────────────────────────────────────────────────────
  const desktop = join(homedir(), 'Desktop');
  mkdirSync(desktop, { recursive: true });
  const stem = `cropsetu_${jobId.slice(0,8)}`;
  const htmlPath = join(desktop, `${stem}.html`);
  const jsonPath = join(desktop, `${stem}.json`);
  writeFileSync(htmlPath, html, 'utf-8');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`\n  ✓ HTML : ${htmlPath}`);
  console.log(`  ✓ JSON : ${jsonPath}`);
  console.log(`\n  Pipeline: ${meta.pipeline_seconds || '?'}s · ${meta.model_diagnose || '?'} → ${meta.model_treatment || '?'}`);
  console.log(`  Disease : ${dx.name_common || '?'} (${dx.confidence_pct || '?'}%)`);

  // Open in default browser
  spawnSync('open', [htmlPath], { stdio: 'ignore' });
  console.log(`\n  → Opened in browser. Use Cmd+P → "Save as PDF" to export.\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
