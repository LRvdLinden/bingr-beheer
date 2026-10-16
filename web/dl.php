<?php
// Download van een Bingr-build uit de afgesloten map builds/ (die is via de webserver niet bereikbaar).
// Alleen met een geldige link uit de functie admin: ?t=<payload>.<handtekening>, HMAC-SHA256 met de sleutel in
// builds/key.php (gezet door de workflow Builds, zelfde waarde als het function-secret BINGR_BUILDS_KEY).
// payload = base64url(JSON {"f": "<map>/<bestand>" of "manifest.json", "e": <verloopt, unix-tijd>}); max. 15 minuten geldig.
// Geen logging van de link. ?ping=1 -> {"ok":true,"ready":bool} voor de controle in de workflows.
declare(strict_types=1);
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');

$dir = __DIR__ . '/builds';

function out(int $code, array $body): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($body);
  exit;
}
function b64url_decode(string $s) {
  return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
}

if (isset($_GET['ping'])) out(200, ['ok' => true, 'ready' => is_file($dir . '/key.php')]);
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') out(405, ['error' => 'method']);

$t = (string)($_GET['t'] ?? '');
if (!preg_match('/^([A-Za-z0-9_-]{10,800})\.([A-Za-z0-9_-]{43})$/', $t, $m)) out(400, ['error' => 'bad_token']);
$key = is_file($dir . '/key.php') ? (string)(include $dir . '/key.php') : '';
if (strlen($key) < 32) out(503, ['error' => 'not_ready']);
$sig = b64url_decode($m[2]);
if ($sig === false || !hash_equals(hash_hmac('sha256', $m[1], $key, true), $sig)) out(403, ['error' => 'bad_token']);
$raw = b64url_decode($m[1]);
$p = $raw === false ? null : json_decode($raw, true);
$now = time();
if (!is_array($p) || !is_int($p['e'] ?? null) || $p['e'] < $now || $p['e'] > $now + 900) out(403, ['error' => 'expired']);
$f = (string)($p['f'] ?? '');
if (!preg_match('#^(manifest\.json|(apple|android|tizen|beheer)/[A-Za-z0-9][A-Za-z0-9._-]{0,150})$#', $f) || strpos($f, '..') !== false) {
  out(400, ['error' => 'bad_file']);
}
$path = $dir . '/' . $f;
if (!is_file($path)) out(404, ['error' => 'not_found']);

@set_time_limit(0);
while (ob_get_level() > 0) ob_end_clean();
$name = basename($f);
if ($f === 'manifest.json') {
  header('Content-Type: application/json; charset=utf-8');
} else {
  header('Content-Type: application/octet-stream');
  header('Content-Disposition: attachment; filename="' . $name . '"');
}
header('Content-Length: ' . (string)filesize($path));
readfile($path);
