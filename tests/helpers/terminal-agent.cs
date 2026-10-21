using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

class TerminalAgent {
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll")] static extern bool GetConsoleMode(IntPtr handle, out uint mode);
  [DllImport("kernel32.dll")] static extern bool SetConsoleMode(IntPtr handle, uint mode);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool ReadConsoleW(IntPtr handle, [Out] char[] buffer, uint length, out uint read, IntPtr reserved);
  static void Main(string[] args) {
    string kind = Path.GetFileName(System.Reflection.Assembly.GetExecutingAssembly().Location).StartsWith("claude") ? "claude" : "codex";
    if (Array.IndexOf(args, "--version") >= 0) { Console.WriteLine(kind == "codex" ? "codex-cli 0.154.0" : "2.1.0 (Claude Code)"); return; }
    Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
    uint mode; IntPtr input = GetStdHandle(-10);
    if (!GetConsoleMode(input, out mode) || !SetConsoleMode(input, (mode & ~7u) | 0x0200u)) throw new Exception("VT input unavailable");
    string root = AppDomain.CurrentDomain.BaseDirectory, stateFile = Path.Combine(root, kind + "-input.json");
    var state = new State(); var json = new JavaScriptSerializer();
    Action save = () => File.WriteAllText(stateFile, json.Serialize(state), new UTF8Encoding(false));
    Console.Write("\x1b[?2004hAGENT-INPUT-READY\r\n"); save();
    bool disabled = false;
    var timer = new Timer(_ => {
      if (File.Exists(Path.Combine(root, kind + "-exit"))) Environment.Exit(0);
      if (!disabled && File.Exists(Path.Combine(root, kind + "-disable-paste"))) { disabled = true; Console.Write("\x1b[?2004lPASTE-DISABLED\r\n"); }
    }, null, 50, 50);
    char[] buffer = new char[4096]; string pending = ""; bool pasted = false;
    while (true) {
      uint count; if (!ReadConsoleW(input, buffer, (uint)buffer.Length, out count, IntPtr.Zero) || count == 0) break;
      string text = new string(buffer, 0, (int)count); pending += text; state.received += text;
      while (pending.Length > 0) {
        const string start = "\x1b[200~", end = "\x1b[201~";
        if (pending.StartsWith(start)) { pasted = true; pending = pending.Substring(start.Length); continue; }
        if (pending.StartsWith(end)) { pasted = false; state.pastes++; pending = pending.Substring(end.Length); continue; }
        if (start.StartsWith(pending) || end.StartsWith(pending)) break;
        char c = pending[0]; pending = pending.Substring(1);
        if (!pasted && (c == '\r' || c == '\n')) { state.submissions.Add(state.draft); state.draft = ""; }
        else if (c == '\x03') Environment.Exit(0);
        else state.draft += c;
      }
      save(); Console.Write("INPUT-RECORDED\r\n");
    }
    timer.Dispose();
  }
  public class State {
    public string draft = "", received = "";
    public int pastes = 0;
    public List<string> submissions = new List<string>();
  }
}
