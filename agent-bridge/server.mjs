import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const PATH = '/.well-known/topos-agent/v1/';
const token = () => randomBytes(32).toString('hex');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function codexIdentity(env = process.env) {
    const id = env.CODEX_THREAD_ID || env.CODEX_SESSION_ID;
    if (!id || !UUID.test(id)) throw new Error('Run this command inside the Codex conversation. No valid CODEX_THREAD_ID / CODEX_SESSION_ID is available.');
    if (env.CODEX_THREAD_ID && env.CODEX_SESSION_ID && env.CODEX_THREAD_ID !== env.CODEX_SESSION_ID) throw new Error('Conflicting Codex conversation IDs; refusing to guess.');
    return { kind: 'agent', provider: 'OpenAI', name: 'Codex', conversation_source: 'codex_sessions', conversation_id: `codex:${id}` };
}
// Claude Code (CLI and Claude Desktop's Code tab) exports its transcript ID to tool
// processes; TOPOS stores that transcript as claude_code:<session-id>.
export function claudeCodeIdentity(env = process.env) {
    const id = env.CLAUDE_CODE_SESSION_ID;
    if (env.CLAUDECODE !== '1' || !id || !UUID.test(id)) throw new Error('Run this command inside the Claude Code conversation. No valid CLAUDE_CODE_SESSION_ID is available.');
    return { kind: 'agent', provider: 'Anthropic', name: 'Claude', conversation_source: 'claude_code_sessions', conversation_id: `claude_code:${id}` };
}
export const ADAPTERS = { codex: codexIdentity, claude: claudeCodeIdentity };
// One agent nested inside another inherits both environments; never pick for it.
export function agentIdentity(env = process.env, agent = null) {
    if (agent) {
        if (!ADAPTERS[agent]) throw new Error(`Unknown agent "${agent}". Use ${Object.keys(ADAPTERS).join(' or ')}.`);
        return ADAPTERS[agent](env);
    }
    const found = Object.keys(ADAPTERS).filter(name => { try { ADAPTERS[name](env); return true; } catch { return false; } });
    if (found.length > 1) throw new Error(`Both ${found.join(' and ')} conversation IDs are present; pass --agent to say which agent controls the browser.`);
    if (!found.length) throw new Error('No supported agent conversation found. Run inside Codex or Claude Code, or pass --agent for a clearer error.');
    return ADAPTERS[found[0]](env);
}
export function httpUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) URL without credentials.');
    return url.href;
}
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TOPOS agent handoff</title><style>
[hidden]{display:none!important}body{font:17px system-ui;background:#111419;color:#eef0f6;margin:0;padding:64px 10%;line-height:1.6}main{max-width:820px}h1{font-size:34px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#202630;padding:20px;border-radius:12px}a{color:#9cd9ff}#continue{display:inline-block;background:#6250b6;color:white;padding:12px 20px;border-radius:9px;text-decoration:none}small{color:#b8c3d4}</style></head>
<body><main><small>TOPOS · LOCAL AGENT HANDOFF</small><h1 id="status">Waiting for the browser extension</h1><p id="description">Keep this tab open. The extension will assign the agent and conversation before browsing starts.</p><pre id="identity">No identity assigned yet.</pre><p><a id="continue" hidden>Continue browsing</a></p><p><a id="end" hidden>End agent control of this tab</a></p><h2>Delivery evidence</h2><pre id="receipts">No captured activity yet.</pre><p><small>This local page never asks you to fill in the agent’s information. If it keeps waiting, check that the updated extension is loaded and has website access.</small></p></main><script src="${PATH}client.js"></script></body></html>`;
const client = `const ticket=location.hash.slice(1);async function update(){try{const r=await fetch('${PATH}status',{headers:{Authorization:'Bearer '+ticket},cache:'no-store'});if(!r.ok)throw Error('Handoff expired or unavailable');const s=await r.json();document.getElementById('status').textContent=s.ended?'Agent control ended':s.ack?'Attributed to '+s.ack.actor.name:'Waiting for the browser extension';document.getElementById('description').textContent=s.ack?'Identity supplied automatically by the local agent.':'Keep this tab open. The extension will assign the agent and conversation before browsing starts.';document.getElementById('identity').textContent=JSON.stringify(s.ack?.actor||{status:'waiting'},null,2);const a=document.getElementById('continue');a.hidden=!s.ack||s.ended;a.href=s.target;a.textContent='Continue to '+new URL(s.target).hostname;const end=document.getElementById('end');end.hidden=!s.ack||s.ended;end.href=s.end_url;document.getElementById('receipts').textContent=JSON.stringify(s.receipts,null,2);if(!s.ended)setTimeout(update,1000)}catch(e){document.getElementById('description').textContent=e.message}}update();`;

export async function startBridge({ actor, target, verifyOrigin = null, evidenceFile = null, leaseMinutes = 15, port = 0, ticketMs = 10 * 60000, now = Date.now } = {}) {
    target = httpUrl(target);
    if (actor?.kind !== 'agent' || !['provider', 'name', 'conversation_source', 'conversation_id'].every(k => typeof actor[k] === 'string' && actor[k].trim())) throw new Error('Complete agent identity required.');
    if (!Number.isFinite(leaseMinutes) || leaseMinutes < 1 || leaseMinutes > 720) throw new Error('Lease must be between 1 and 720 minutes.');
    if (verifyOrigin) verifyOrigin = new URL(httpUrl(verifyOrigin)).origin;
    const ticket = token(), secret = token(), release = token();
    const issued = now(), expires = issued + leaseMinutes * 60000;
    let origin, claimant = null, ack = null, ended = false, receipts = [], writeTail = Promise.resolve();
    const persist = () => {
        if (!evidenceFile) return Promise.resolve();
        const data = JSON.stringify({ protocol: 1, issued_at: new Date(issued).toISOString(), expires_at: new Date(expires).toISOString(), expected_actor: actor, target, verify_origin: verifyOrigin, ack, ended, receipts }, null, 2);
        writeTail = writeTail.then(() => writeFile(evidenceFile, data + '\n', { mode: 0o600 }));
        return writeTail;
    };
    const server = http.createServer(async (req, res) => {
        const send = (status, value, type = 'application/json') => {
            res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
            res.end(type === 'application/json' ? JSON.stringify(value) : value);
        };
        // Exact Host and loopback bind prevent DNS rebinding. No remote-page CORS.
        if (req.headers.host !== new URL(origin).host) return send(403, { error: 'Invalid host' });
        const requestOrigin = req.headers.origin;
        if (requestOrigin && requestOrigin !== origin && !/^(chrome-extension|safari-web-extension):\/\/[^/]+$/.test(requestOrigin)) return send(403, { error: 'Invalid origin' });
        if (requestOrigin) res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Topos-Agent-Bridge');
            res.setHeader('Access-Control-Allow-Methods', 'POST, GET');
            return send(204, {});
        }
        const path = req.url;
        if (req.method === 'GET' && [PATH + 'connect', PATH + 'end'].includes(path)) return send(200, html, 'text/html; charset=utf-8');
        if (req.method === 'GET' && path === PATH + 'client.js') return send(200, client, 'text/javascript');
        const auth = req.headers.authorization?.replace(/^Bearer /, '');
        if (req.method === 'GET' && path === PATH + 'status' && [ticket, release].includes(auth)) {
            return send(200, { ack, ended, receipts, target, end_url: origin + PATH + 'end#' + release });
        }
        if (req.method !== 'POST' || req.headers['x-topos-agent-bridge'] !== '1' || requestOrigin === origin) return send(403, { error: 'Extension request required' });
        let body;
        try {
            let raw = '';
            for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 128 * 1024) throw new Error('Too large'); }
            body = JSON.parse(raw);
        } catch { return send(400, { error: 'Invalid body' }); }
        if (path === PATH + 'claim' && auth === ticket && !ended && now() < expires) {
            if (!UUID.test(body.client_id || '')) return send(400, { error: 'Invalid client' });
            if (claimant && claimant !== body.client_id) return send(409, { error: 'Ticket already claimed by another tab' });
            if (!claimant && now() >= issued + ticketMs) return send(410, { error: 'Ticket expired' });
            claimant = body.client_id;
            return send(200, { protocol: 1, actor, expires_at: expires, secret, release, verify_origin: verifyOrigin });
        }
        if (auth !== secret || !claimant || now() >= expires) return send(403, { error: 'Invalid capability' });
        if (path === PATH + 'ack' && !ended) {
            if (Object.keys(actor).some(k => body.actor?.[k] !== actor[k]) || !UUID.test(body.actor?.session_id || '')) return send(400, { error: 'Identity mismatch' });
            ack = { actor: body.actor, extension_version: String(body.extension_version).slice(0, 30), user_agent: String(body.user_agent).slice(0, 400), received_at: new Date(now()).toISOString() };
            await persist();
            return send(200, { ok: true });
        }
        if (path === PATH + 'ended' && ack && body.session_id === ack.actor.session_id) { ended = true; await persist(); return send(200, { ok: true }); }
        if (path === PATH + 'receipt' && ack && !ended && verifyOrigin && receipts.length < 100) {
            if (!['browser_visits', 'browser_events', 'starred_websites'].includes(body.source_id) || !Array.isArray(body.records) || body.records.length !== 1) return send(400, { error: 'Invalid activity envelope' });
            const r = body.records[0];
            let valid = false;
            try { valid = new URL(r.url).origin === verifyOrigin && r.actor?.session_id === ack.actor.session_id && Object.keys(actor).every(k => r.actor[k] === actor[k]); } catch { /* reject */ }
            if (!valid) return send(400, { error: 'Activity is outside this verification session' });
            receipts.push({ received_at: new Date(now()).toISOString(), ...body });
            await persist();
            return send(200, { ok: true });
        }
        send(404, { error: 'Unknown request' });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    await persist();
    return { server, origin, launchUrl: origin + PATH + 'connect#' + ticket, endUrl: origin + PATH + 'end#' + release, expires, close: () => new Promise(resolve => server.close(resolve)) };
}
