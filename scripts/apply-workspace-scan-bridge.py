from pathlib import Path

path = Path("src/main.ts")
text = path.read_text()
marker = 'tihulu:workspace-scan-source'
if marker in text:
    raise SystemExit(0)

needle = '  window.addEventListener("tihulu:workspace-visible-scope", (event) => {\n'
insert = '''  window.addEventListener("tihulu:workspace-scan-source", (event) => {
    const source = (event as CustomEvent<{ source?: string }>).detail?.source;
    if (typeof source !== "string" || !source.trim()) return;
    inputPath = source;
    setPath(inputPathEl, inputPath, "Choose a folder containing your night-sky photos");
    qs<HTMLElement>("#photoSourcePath").textContent = inputPath;
    updateStartState();
    setSection("photos");
    void scanPhotos(inputPath);
  });
'''
if needle not in text:
    raise SystemExit("workspace-visible-scope listener marker not found")
path.write_text(text.replace(needle, insert + needle, 1))
