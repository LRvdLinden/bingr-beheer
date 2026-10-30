<?php
// Download van een Bingr-build uit de afgesloten map builds/ (die is via de webserver niet bereikbaar).
// Alleen met een geldige link uit de functie admin: ?t=<payload>.<handtekening>, HMAC-SHA256 met de sleutel in
// builds/key.php (gezet door de workflow Builds, zelfde waarde als het function-secret BINGR_BUILDS_KEY).
// payload = base64url(JSON {"f": "<map>/<bestand>" of "manifest.json", "e": <verloopt, unix-tijd>}); max. 15 minuten geldig.
// payload f mag ook "presskit-stats.json" of "windows-stats.json" zijn (downloadtellers, alleen voor de functie admin).
// Openbaar (bingr.online, knop "Testversie downloaden"): ?app=android levert ALLEEN de nieuwste Android-APK uit
// builds/manifest.json, zonder token. Andere platforms (ook de App Bundle android-aab), oudere builds en het manifest blijven
// alleen via een link uit het beheer.
// Openbaar (bingr.online/windows, knop "Download voor Windows"): ?app=windows levert ALLEEN de nieuwste Windows-installer
// (.exe, platform windows) uit het manifest, met Range (hervatten). Telt net als de presskit in builds/windows-stats.json
// (per build in plaats van per versie; alleen als dat bestand er is, workflow Builds maakt het aan). Staat er nog geen
// Windows-build op de server, dan een nette 404-pagina (HTML, NL en EN) in plaats van JSON.
// Openbaar (bingr.online/presskit, link "PressKit" in de footer): ?app=presskit levert de nieuwste presskit uit het manifest
// (platform presskit, workflow PressKit) als Bingr-PressKit.zip, met Range (hervatten). Elke GET zonder Range, of met een
// Range vanaf byte 0, telt als download in builds/presskit-stats.json (totaal, per versie, per dag in NL-tijd, max. 400 dagen;
// met flock). Geen IP-adressen, user-agents of andere persoonsgegevens. HEAD en Range-vervolgverzoeken tellen niet.
// HEAD geeft alleen de koppen (statuspagina: is het bestand er?). Geen logging van de link.
// ?ping=1 -> {"ok":true,"ready":bool,"stats":bool,"winstats":bool} voor de controle in de workflows (teller presskit / windows schrijfbaar).
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

$statsFile = $dir . '/presskit-stats.json';
$winStatsFile = $dir . '/windows-stats.json';
if (isset($_GET['ping'])) out(200, ['ok' => true, 'ready' => is_file($dir . '/key.php'), 'stats' => is_file($statsFile) && is_writable($statsFile),
  'winstats' => is_file($winStatsFile) && is_writable($winStatsFile)]);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'HEAD') out(405, ['error' => 'method']);

// teller van de presskit of de Windows-installer ophogen (zonder persoonsgegevens); fouten negeren, de download gaat altijd door
function dl_count(string $file, string $version): void {
  $fh = @fopen($file, 'c+');
  if ($fh === false) return;
  if (@flock($fh, LOCK_EX)) {
    $raw = stream_get_contents($fh);
    $s = json_decode($raw === false ? '' : $raw, true);
    if (!is_array($s)) $s = [];
    $total = is_int($s['total'] ?? null) ? $s['total'] : 0;
    $byV = is_array($s['by_version'] ?? null) ? $s['by_version'] : [];
    $byD = is_array($s['by_day'] ?? null) ? $s['by_day'] : [];
    $day = (new DateTime('now', new DateTimeZone('Europe/Amsterdam')))->format('Y-m-d');
    $total++;
    $byV[$version] = (is_int($byV[$version] ?? null) ? $byV[$version] : 0) + 1;
    $byD[$day] = (is_int($byD[$day] ?? null) ? $byD[$day] : 0) + 1;
    // alleen geldige dagen, de nieuwste 400
    $byD = array_filter($byD, fn($v, $k) => is_int($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$k), ARRAY_FILTER_USE_BOTH);
    krsort($byD, SORT_STRING);
    $byD = array_slice($byD, 0, 400, true);
    ksort($byD, SORT_STRING);
    $byV = array_slice(array_filter($byV, fn($v, $k) => is_int($v) && preg_match('/^[0-9][0-9A-Za-z.\-]{0,19}$/', (string)$k), ARRAY_FILTER_USE_BOTH), -200, null, true);
    $json = json_encode(['total' => $total, 'by_version' => (object)$byV, 'by_day' => (object)$byD], JSON_UNESCAPED_SLASHES);
    if ($json !== false) {
      ftruncate($fh, 0);
      rewind($fh);
      fwrite($fh, $json);
      fflush($fh);
    }
    flock($fh, LOCK_UN);
  }
  fclose($fh);
}

// koppen voor een bestand, met één Range (bytes=a-b, a-, -n) voor hervatten; geeft [begin, lengte] van het te sturen stuk
function file_headers(string $path, string $type, string $name, string $etag = ''): array {
  $size = (int)filesize($path);
  $start = 0; $end = $size - 1;
  $range = (string)($_SERVER['HTTP_RANGE'] ?? '');
  $ifRange = (string)($_SERVER['HTTP_IF_RANGE'] ?? '');
  if ($range !== '' && ($ifRange === '' || ($etag !== '' && $ifRange === $etag))) {
    if (!preg_match('/^bytes=(\d*)-(\d*)$/', trim($range), $r) || ($r[1] === '' && $r[2] === '')) {
      http_response_code(416); header('Content-Range: bytes */' . $size); exit;
    }
    if ($r[1] === '') { $start = max(0, $size - (int)$r[2]); }
    else { $start = (int)$r[1]; if ($r[2] !== '') $end = min($end, (int)$r[2]); }
    if ($start > $end || $start >= $size) { http_response_code(416); header('Content-Range: bytes */' . $size); exit; }
    http_response_code(206);
    header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
  }
  @set_time_limit(0);
  while (ob_get_level() > 0) ob_end_clean();
  header('Content-Type: ' . $type);
  header('Content-Disposition: attachment; filename="' . $name . '"');
  header('Accept-Ranges: bytes');
  if ($etag !== '') header('ETag: ' . $etag);
  header('Content-Length: ' . (string)($end - $start + 1));
  return [$start, $end - $start + 1];
}
function stream_part(string $path, int $start, int $len): void {
  $fh = fopen($path, 'rb');
  if ($fh === false) return;
  fseek($fh, $start);
  while ($len > 0 && !feof($fh)) {
    $chunk = fread($fh, min(1 << 20, $len));
    if ($chunk === false || $chunk === '') break;
    echo $chunk; flush();
    $len -= strlen($chunk);
  }
  fclose($fh);
}

// nette 404-pagina (HTML) voor een openbare download die er (nog) niet is; stijl in dl.css (CSP: geen inline styles)
function not_found_page(): void {
  http_response_code(404);
  header('Content-Type: text/html; charset=utf-8');
  if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') exit;
  echo '<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    . '<meta name="robots" content="noindex, nofollow"><title>Bingr voor Windows · nog niet beschikbaar</title>'
    . '<link rel="icon" href="favicon.png"><link rel="stylesheet" href="dl.css"></head><body><main class="nf">'
    . '<img src="app-icon.png" alt="" width="72" height="72">'
    . '<h1>Bingr voor Windows komt eraan</h1>'
    . '<p>De Windows-installer staat nog niet klaar. Kijk later nog eens, of kijk nu al in je browser.</p>'
    . '<p class="en" lang="en">Bingr for Windows is on its way. The installer isn\'t ready yet: check back later, or watch in your browser now.</p>'
    . '<p class="btns"><a class="btn" href="https://bingr.online/web/">Kijk in je browser</a><a class="btn ghost" href="https://bingr.online/#download">Naar bingr.online</a></p>'
    . '</main></body></html>';
  exit;
}

// openbare downloads zonder token: de nieuwste APK (testversie), de nieuwste Windows-installer (testversie) en de nieuwste presskit
if (isset($_GET['app'])) {
  $app = (string)$_GET['app'];
  if ($app !== 'android' && $app !== 'presskit' && $app !== 'windows') out(400, ['error' => 'bad_app']);
  $man = is_file($dir . '/manifest.json') ? json_decode((string)file_get_contents($dir . '/manifest.json'), true) : null;
  $entry = is_array($man) && is_array($man['platforms'][$app] ?? null) ? $man['platforms'][$app] : [];
  $file = (string)($entry['file'] ?? '');
  $ext = ['android' => 'apk', 'presskit' => 'zip', 'windows' => 'exe'][$app];
  $missing = !preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.' . $ext . '$/', $file) || strpos($file, '..') !== false
    || !is_file($dir . '/' . $app . '/' . $file);
  if ($missing && $app === 'windows') not_found_page();
  if ($missing) out(404, ['error' => 'not_found']);
  $path = $dir . '/' . $app . '/' . $file;
  $sha = (string)($entry['sha256'] ?? '');
  $etag = preg_match('/^[0-9a-f]{64}$/', $sha) ? '"' . substr($sha, 0, 32) . '"' : '';
  if ($app === 'windows') {
    // teller per build (zoals de presskit per versie); tellen bij een volledige GET of het eerste stuk (Range vanaf 0)
    $build = (string)($entry['build'] ?? '');
    if (!preg_match('/^[0-9][0-9A-Za-z.\-]{0,19}$/', $build)) $build = 'onbekend';
    [$start, $len] = file_headers($path, 'application/vnd.microsoft.portable-executable', $file, $etag);
    if ($method === 'HEAD') exit;
    if ($start === 0 && $build !== 'onbekend' && is_file($winStatsFile)) dl_count($winStatsFile, $build);
    stream_part($path, $start, $len);
    exit;
  }
  if ($app === 'android') {
    @set_time_limit(0);
    while (ob_get_level() > 0) ob_end_clean();
    header('Content-Type: application/vnd.android.package-archive');
    header('Content-Disposition: attachment; filename="' . $file . '"');
    header('Content-Length: ' . (string)filesize($path));
    if ($method === 'HEAD') exit;
    readfile($path);
    exit;
  }
  // presskit
  $version = (string)($entry['version'] ?? '');
  if (!preg_match('/^[0-9][0-9A-Za-z.\-]{0,19}$/', $version)) $version = 'onbekend';
  [$start, $len] = file_headers($path, 'application/zip', 'Bingr-PressKit.zip', $etag);
  if ($method === 'HEAD') exit;
  // tellen: een volledige GET (geen Range) of het eerste stuk (Range vanaf byte 0); vervolgstukken niet
  if ($start === 0 && $version !== 'onbekend' && is_file($statsFile)) dl_count($statsFile, $version);
  stream_part($path, $start, $len);
  exit;
}

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
if (!preg_match('#^(manifest\.json|presskit-stats\.json|windows-stats\.json|(apple|android|android-aab|windows|beheer|presskit)/[A-Za-z0-9][A-Za-z0-9._-]{0,150})$#', $f) || strpos($f, '..') !== false) {
  out(400, ['error' => 'bad_file']);
}
$path = $dir . '/' . $f;
if (!is_file($path)) out(404, ['error' => 'not_found']);

@set_time_limit(0);
while (ob_get_level() > 0) ob_end_clean();
$name = basename($f);
if ($f === 'manifest.json' || $f === 'presskit-stats.json' || $f === 'windows-stats.json') {
  header('Content-Type: application/json; charset=utf-8');
} else {
  header('Content-Type: application/octet-stream');
  header('Content-Disposition: attachment; filename="' . $name . '"');
}
header('Content-Length: ' . (string)filesize($path));
// HEAD (statuscontrole): alleen de koppen, het bestand niet versturen
if ($method === 'HEAD') exit;
readfile($path);
