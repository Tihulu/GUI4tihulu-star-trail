from pathlib import Path

root = Path(__file__).resolve().parents[1]

cargo = root / "src-tauri/Cargo.toml"
text = cargo.read_text()
old = 'tauri = { version = "2", features = [] }'
new = 'tauri = { version = "2", features = ["protocol-asset"] }'
if old not in text:
    raise SystemExit("tauri dependency feature anchor missing")
cargo.write_text(text.replace(old, new, 1))

lib = root / "src-tauri/src/lib.rs"
text = lib.read_text()
marker = '''    #[test]\n    fn native_thumbnail_cache_hits_and_invalidates_by_version() {'''
if marker not in text:
    raise SystemExit("thumbnail test marker missing")
extra = '''

    #[test]
    fn hundreds_of_duplicate_thumbnail_requests_are_cache_hits() {
        let root = env::temp_dir().join(format!("gui4tihulu-thumb-repeat-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.png");
        let cache = root.join("cache");
        image::RgbImage::from_pixel(1280, 720, image::Rgb([21, 42, 63])).save(&source).unwrap();
        let first = generate_thumbnail(&cache, &source, 200, 120, "stable").unwrap();
        assert!(!first.cache_hit);
        for _ in 0..400 {
            let repeated = generate_thumbnail(&cache, &source, 200, 120, "stable").unwrap();
            assert!(repeated.cache_hit);
            assert_eq!(first.path, repeated.path);
        }
        assert_eq!(fs::read_dir(&cache).unwrap().filter_map(Result::ok).count(), 1);
        let _ = fs::remove_dir_all(root);
    }
'''
last = text.rfind("\n}")
if last < 0:
    raise SystemExit("tests module closing brace missing")
lib.write_text(text[:last] + extra + text[last:])

(root / "scripts/fix-v039-stage2.py").unlink(missing_ok=True)
print("stage 2 cargo/test fixes applied")
