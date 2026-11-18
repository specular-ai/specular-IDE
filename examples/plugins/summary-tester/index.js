export function activate({ root, request, summaries }) {
  root.innerHTML = '<main style="padding:20px;font:14px system-ui"><h2>Summary tester</h2>' +
    '<p><label>Feature <select id="feature"></select></label> <label>Agent <select id="agent"><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label></p>' +
    '<p><button id="get">Get stored</button> <button id="gen">Generate</button> <button id="cancel">Cancel</button></p><pre id="out" style="white-space:pre-wrap"></pre></main>';
  const $ = s => root.querySelector(s), show = v => { $('#out').textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2); };
  const fill = r => { const sel = $('#feature'), keep = sel.value; sel.replaceChildren(...r.models.project.configuration.features.map(f => new Option(f.name, f.key))); if (keep) sel.value = keep; };
  const subject = () => ({ kind: 'feature', key: $('#feature').value });
  $('#get').onclick = () => summaries.get(subject()).then(r => show(r ?? 'No stored summary.'), e => show('Error: ' + e.message));
  $('#gen').onclick = () => { show('Generating…'); summaries.generate(subject(), { agent: $('#agent').value }).then(show, e => show('Error: ' + e.message)); };
  $('#cancel').onclick = () => summaries.cancel(subject());
  fill(request);
  return { update: fill };
}
