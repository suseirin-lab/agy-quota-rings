using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace AgyQuotaRings
{
    internal static class WatcherProgram
    {
        private const string RemoveExpr =
            "(() => { if (window.__agQuotaRings && typeof window.__agQuotaRings.destroy === 'function') { window.__agQuotaRings.destroy(); delete window.__agQuotaRings; } document.querySelectorAll('#ag-qr-style, #ag-qr-gfont, .ag-qr-dock, .ag-qr-popover').forEach(n => n.remove()); return 'removed'; })()";

        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };

        private static int Main(string[] args)
        {
            var argSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string payloadPath = null;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i].Equals("--payload", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    payloadPath = args[++i];
                }
                else
                {
                    argSet.Add(args[i]);
                }
            }

            if (string.IsNullOrEmpty(payloadPath))
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                payloadPath = Path.Combine(baseDir, "quota-rings.js");
            }

            bool isRemove = argSet.Contains("--remove");
            bool isManaged = argSet.Contains("--managed");
            bool isResident = argSet.Contains("--resident") || !isManaged;
            bool allowAutoUpdate = !argSet.Contains("--no-auto-update") && !IsAutoUpdateDisabledByEnv();

            if (isRemove)
            {
                RunRemoveAsync().GetAwaiter().GetResult();
                return 0;
            }

            bool createdNew;
            using (var mutex = new Mutex(true, "Local\\AGYQuotaRingsWatcherMutex", out createdNew))
            {
                if (!createdNew)
                {
                    if (isManaged)
                    {
                        EnsureAntigravityWithCdp(true, false);
                    }
                    return 0;
                }

                RunLoopAsync(payloadPath, isManaged, isResident, allowAutoUpdate).GetAwaiter().GetResult();
            }
            return 0;
        }

        private const string DefaultUpdateRepo = "suseirin-lab/agy-quota-rings";
        private static readonly TimeSpan UpdateCheckInterval = TimeSpan.FromHours(6);

        private static bool IsAutoUpdateDisabledByEnv()
        {
            string val = (Environment.GetEnvironmentVariable("AGY_QR_NO_AUTO_UPDATE") ?? "").Trim().ToLowerInvariant();
            return val == "1" || val == "true" || val == "yes";
        }

        private static string GetUpdateRepo()
        {
            string raw = (Environment.GetEnvironmentVariable("AGY_QR_UPDATE_REPO") ?? "").Trim();
            if (!string.IsNullOrEmpty(raw) && Regex.IsMatch(raw, @"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"))
                return raw;
            return DefaultUpdateRepo;
        }

        private static int[] ParseSemver(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return null;
            var m = Regex.Match(raw.Trim().TrimStart('v', 'V'), @"^(\d+)\.(\d+)\.(\d+)");
            if (!m.Success) return null;
            return new[] { int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value) };
        }

        private static bool IsNewerVersion(string remoteVer, string localVer)
        {
            var r = ParseSemver(remoteVer);
            var l = ParseSemver(localVer);
            if (r == null) return false;
            if (l == null) return true;
            for (int i = 0; i < 3; i++)
            {
                if (r[i] != l[i]) return r[i] > l[i];
            }
            return false;
        }

        private static string ReadLocalPayloadVersion(string payloadPath)
        {
            string ver = "0.0.0";
            try
            {
                if (File.Exists(payloadPath))
                {
                    string code = File.ReadAllText(payloadPath, Encoding.UTF8);
                    var m = Regex.Match(code, @"version\s*:\s*['""]([0-9]+\.[0-9]+\.[0-9]+)['""]");
                    if (m.Success) ver = m.Groups[1].Value;
                }
            }
            catch { }
            try
            {
                string verFile = Path.Combine(Path.GetDirectoryName(payloadPath) ?? "", "version.txt");
                if (File.Exists(verFile))
                {
                    string fVer = File.ReadAllText(verFile, Encoding.UTF8).Trim();
                    if (IsNewerVersion(fVer, ver)) ver = fVer;
                }
            }
            catch { }
            return ver;
        }

        private static async Task CheckHotUpdateAsync(string payloadPath)
        {
            try
            {
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                string repo = GetUpdateRepo();
                using (var client = new HttpClient { Timeout = TimeSpan.FromSeconds(12) })
                {
                    client.DefaultRequestHeaders.UserAgent.ParseAdd("agy-quota-rings-watcher");
                    client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");

                    string apiJson = await client.GetStringAsync("https://api.github.com/repos/" + repo + "/releases/latest").ConfigureAwait(false);
                    var rel = Json.Deserialize<Dictionary<string, object>>(apiJson);
                    if (rel == null || !rel.ContainsKey("tag_name")) return;
                    string tag = (rel["tag_name"] as string ?? "").Trim();
                    if (string.IsNullOrEmpty(tag)) return;

                    string localVer = ReadLocalPayloadVersion(payloadPath);
                    if (!IsNewerVersion(tag, localVer)) return;

                    string downloadUrl = "https://raw.githubusercontent.com/" + repo + "/" + Uri.EscapeDataString(tag) + "/src/quota-rings.js";
                    object assetsObj;
                    if (rel.TryGetValue("assets", out assetsObj) && assetsObj is IEnumerable)
                    {
                        foreach (var item in (IEnumerable)assetsObj)
                        {
                            var asset = item as Dictionary<string, object>;
                            if (asset == null) continue;
                            object nameObj, dlObj;
                            if (asset.TryGetValue("name", out nameObj) && "quota-rings.js".Equals(nameObj as string) &&
                                asset.TryGetValue("browser_download_url", out dlObj) && !string.IsNullOrEmpty(dlObj as string))
                            {
                                downloadUrl = (string)dlObj;
                                break;
                            }
                        }
                    }

                    string nextCode = await client.GetStringAsync(downloadUrl).ConfigureAwait(false);
                    if (string.IsNullOrEmpty(nextCode) || nextCode.Length < 2048 ||
                        !nextCode.Contains("__agQuotaRings") || !nextCode.Contains("createInstance"))
                    {
                        return;
                    }

                    string tmpPath = payloadPath + ".tmp";
                    File.WriteAllText(tmpPath, nextCode, Encoding.UTF8);
                    if (File.Exists(payloadPath))
                    {
                        File.Replace(tmpPath, payloadPath, null);
                    }
                    else
                    {
                        File.Move(tmpPath, payloadPath);
                    }
                    try
                    {
                        string verFile = Path.Combine(Path.GetDirectoryName(payloadPath) ?? "", "version.txt");
                        File.WriteAllText(verFile, tag.TrimStart('v', 'V'), Encoding.UTF8);
                    }
                    catch { }
                }
            }
            catch { }
        }

        private static HttpClient CreateLocalHttpClient()
        {
            var handler = new HttpClientHandler { UseProxy = false };
            return new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(3) };
        }

        private static int? ReadCdpPort()
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] candidates =
            {
                Path.Combine(appData, "Antigravity", "DevToolsActivePort"),
                Path.Combine(localAppData, "Antigravity", "DevToolsActivePort"),
            };

            foreach (string path in candidates)
            {
                try
                {
                    if (!File.Exists(path)) continue;
                    string text = File.ReadAllText(path, Encoding.UTF8).Trim();
                    string firstLine = text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)[0].Trim();
                    int port;
                    if (int.TryParse(firstLine, out port) && port > 0 && port < 65536)
                        return port;
                }
                catch { }
            }
            return null;
        }

        private static string FindAntigravityExe()
        {
            string envPath = Environment.GetEnvironmentVariable("ANTIGRAVITY_PATH");
            if (!string.IsNullOrEmpty(envPath) && File.Exists(envPath)) return envPath;

            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string progFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string progFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);

            string[] candidates =
            {
                Path.Combine(localAppData, "Programs", "Antigravity", "Antigravity.exe"),
                Path.Combine(localAppData, "Antigravity", "Antigravity.exe"),
                Path.Combine(progFiles, "Antigravity", "Antigravity.exe"),
                Path.Combine(progFilesX86, "Antigravity", "Antigravity.exe"),
            };

            foreach (string c in candidates)
            {
                if (!string.IsNullOrEmpty(c) && File.Exists(c)) return c;
            }
            return null;
        }

        private static bool IsAntigravityRunning()
        {
            try
            {
                return Process.GetProcessesByName("Antigravity").Length > 0;
            }
            catch
            {
                return false;
            }
        }

        private static void EnsureAntigravityWithCdp(bool launchIfStopped, bool relaunchIfNoCdp)
        {
            string exePath = FindAntigravityExe();
            if (string.IsNullOrEmpty(exePath)) return;

            bool running = IsAntigravityRunning();
            if (running && relaunchIfNoCdp)
            {
                foreach (var p in Process.GetProcessesByName("Antigravity"))
                {
                    try { p.CloseMainWindow(); } catch { }
                }
                for (int i = 0; i < 20; i++)
                {
                    if (!IsAntigravityRunning()) break;
                    Thread.Sleep(250);
                }
                if (IsAntigravityRunning())
                {
                    foreach (var p in Process.GetProcessesByName("Antigravity"))
                    {
                        try { p.Kill(); } catch { }
                    }
                    for (int i = 0; i < 12; i++)
                    {
                        if (!IsAntigravityRunning()) break;
                        Thread.Sleep(250);
                    }
                }
            }

            if (launchIfStopped || (running && relaunchIfNoCdp))
            {
                try
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = exePath,
                        Arguments = "--remote-debugging-port=0",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                    };
                    Process.Start(psi);
                }
                catch { }
            }
        }

        private static async Task<List<Dictionary<string, object>>> ListTargetsAsync(HttpClient http, int port)
        {
            try
            {
                string raw = await http.GetStringAsync("http://127.0.0.1:" + port + "/json/list").ConfigureAwait(false);
                var arr = Json.Deserialize<List<Dictionary<string, object>>>(raw);
                var result = new List<Dictionary<string, object>>();
                if (arr == null) return result;
                foreach (var item in arr)
                {
                    object typeObj, wsObj, urlObj;
                    if (!item.TryGetValue("type", out typeObj) || !"page".Equals(typeObj as string)) continue;
                    if (!item.TryGetValue("webSocketDebuggerUrl", out wsObj) || string.IsNullOrEmpty(wsObj as string)) continue;
                    if (!item.TryGetValue("url", out urlObj)) continue;
                    string u = urlObj as string ?? "";
                    if (u.StartsWith("http://127.0.0.1:", StringComparison.OrdinalIgnoreCase) ||
                        u.StartsWith("https://127.0.0.1:", StringComparison.OrdinalIgnoreCase))
                    {
                        result.Add(item);
                    }
                }
                return result;
            }
            catch
            {
                return null;
            }
        }

        private static async Task<bool> CdpSendAsync(string wsUrl, string method, Dictionary<string, object> parameters)
        {
            using (var ws = new ClientWebSocket())
            using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(4)))
            {
                try
                {
                    ws.Options.Proxy = null;
                    await ws.ConnectAsync(new Uri(wsUrl), cts.Token).ConfigureAwait(false);
                    var msg = new Dictionary<string, object>
                    {
                        { "id", 1 },
                        { "method", method },
                        { "params", parameters }
                    };
                    byte[] sendBuf = Encoding.UTF8.GetBytes(Json.Serialize(msg));
                    await ws.SendAsync(new ArraySegment<byte>(sendBuf), WebSocketMessageType.Text, true, cts.Token).ConfigureAwait(false);

                    var recvBuf = new byte[16384];
                    while (ws.State == WebSocketState.Open)
                    {
                        var sb = new StringBuilder();
                        WebSocketReceiveResult res;
                        do
                        {
                            res = await ws.ReceiveAsync(new ArraySegment<byte>(recvBuf), cts.Token).ConfigureAwait(false);
                            if (res.MessageType == WebSocketMessageType.Close) return false;
                            sb.Append(Encoding.UTF8.GetString(recvBuf, 0, res.Count));
                        } while (!res.EndOfMessage);

                        try
                        {
                            var obj = Json.Deserialize<Dictionary<string, object>>(sb.ToString());
                            if (obj != null && obj.ContainsKey("id") && Convert.ToInt32(obj["id"]) == 1)
                            {
                                return !obj.ContainsKey("error");
                            }
                        }
                        catch { }
                    }
                }
                catch { }
            }
            return false;
        }

        private static async Task RunRemoveAsync()
        {
            int? port = ReadCdpPort();
            if (!port.HasValue) return;
            using (var http = CreateLocalHttpClient())
            {
                var pages = await ListTargetsAsync(http, port.Value).ConfigureAwait(false);
                if (pages == null) return;
                foreach (var p in pages)
                {
                    string ws = p["webSocketDebuggerUrl"] as string;
                    if (!string.IsNullOrEmpty(ws))
                    {
                        await CdpSendAsync(ws, "Runtime.evaluate", new Dictionary<string, object> { { "expression", RemoveExpr } }).ConfigureAwait(false);
                    }
                }
            }
        }

        private static async Task RunLoopAsync(string payloadPath, bool isManaged, bool isResident, bool allowAutoUpdate)
        {
            using (var http = CreateLocalHttpClient())
            {
                if (isManaged)
                {
                    int? port0 = ReadCdpPort();
                    bool live0 = port0.HasValue && (await ListTargetsAsync(http, port0.Value).ConfigureAwait(false) != null);
                    if (!live0)
                    {
                        EnsureAntigravityWithCdp(true, true);
                    }
                }

                var injected = new Dictionary<string, DateTime>();
                bool seenLivePort = false;
                int missCount = 0;
                bool relaunchedResidentOnce = false;
                DateTime nextUpdateCheckUtc = DateTime.UtcNow.AddSeconds(10);
                int updateInFlight = 0;

                while (true)
                {
                    if (allowAutoUpdate && DateTime.UtcNow >= nextUpdateCheckUtc && Interlocked.CompareExchange(ref updateInFlight, 1, 0) == 0)
                    {
                        nextUpdateCheckUtc = DateTime.UtcNow.Add(UpdateCheckInterval);
                        var _ = Task.Run(async () =>
                        {
                            try { await CheckHotUpdateAsync(payloadPath).ConfigureAwait(false); }
                            finally { Interlocked.Exchange(ref updateInFlight, 0); }
                        });
                    }
                    try
                    {
                        int? port = ReadCdpPort();
                        List<Dictionary<string, object>> pages = null;
                        if (port.HasValue)
                        {
                            pages = await ListTargetsAsync(http, port.Value).ConfigureAwait(false);
                        }

                        if (pages == null)
                        {
                            if (isManaged && seenLivePort)
                            {
                                missCount++;
                                if (missCount >= 3) return;
                            }
                            else if (isResident)
                            {
                                if (IsAntigravityRunning())
                                {
                                    if (!relaunchedResidentOnce)
                                    {
                                        relaunchedResidentOnce = true;
                                        EnsureAntigravityWithCdp(false, true);
                                    }
                                }
                                else
                                {
                                    relaunchedResidentOnce = false;
                                }
                            }
                        }
                        else
                        {
                            seenLivePort = true;
                            missCount = 0;
                            relaunchedResidentOnce = true;

                            if (File.Exists(payloadPath))
                            {
                                DateTime mtime = File.GetLastWriteTimeUtc(payloadPath);
                                string code = File.ReadAllText(payloadPath, Encoding.UTF8);

                                var activeIds = new HashSet<string>();
                                foreach (var p in pages)
                                {
                                    string id = p.ContainsKey("id") ? (p["id"] as string) : null;
                                    if (!string.IsNullOrEmpty(id)) activeIds.Add(id);
                                }
                                var stale = new List<string>();
                                foreach (var k in injected.Keys)
                                {
                                    if (!activeIds.Contains(k)) stale.Add(k);
                                }
                                foreach (var k in stale) injected.Remove(k);

                                foreach (var p in pages)
                                {
                                    string id = p.ContainsKey("id") ? (p["id"] as string) : null;
                                    string ws = p.ContainsKey("webSocketDebuggerUrl") ? (p["webSocketDebuggerUrl"] as string) : null;
                                    if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(ws)) continue;
                                    DateTime prev;
                                    if (injected.TryGetValue(id, out prev) && prev == mtime) continue;

                                    await CdpSendAsync(ws, "Page.addScriptToEvaluateOnNewDocument",
                                        new Dictionary<string, object> { { "source", code } }).ConfigureAwait(false);
                                    bool ok = await CdpSendAsync(ws, "Runtime.evaluate",
                                        new Dictionary<string, object> { { "expression", code } }).ConfigureAwait(false);
                                    if (ok) injected[id] = mtime;
                                }
                            }
                        }
                    }
                    catch { }

                    await Task.Delay(2500).ConfigureAwait(false);
                }
            }
        }
    }
}
