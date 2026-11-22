using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
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

                RunLoopAsync(payloadPath, isManaged, isResident).GetAwaiter().GetResult();
            }
            return 0;
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

        private static async Task RunLoopAsync(string payloadPath, bool isManaged, bool isResident)
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

                while (true)
                {
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
