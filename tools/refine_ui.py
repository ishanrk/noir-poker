from pathlib import Path

css_path = Path("apps/web/app/globals.css")
css = css_path.read_text()


def one(old: str, new: str, label: str) -> None:
    global css
    count = css.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match found {count}")
    css = css.replace(old, new, 1)


one("  grid-template-columns: 1fr auto 1fr;", "  grid-template-columns: 1fr auto;", "header grid")
one(
    '  margin: 12px 0 24px;\n  font-family: Georgia, "Times New Roman", serif;\n  font-size: clamp(48px, 6.4vw, 80px);',
    '  margin: 0 0 24px;\n  font-family: Georgia, "Times New Roman", serif;\n  font-size: clamp(48px, 6.4vw, 80px);',
    "hero title spacing",
)
one(
    ".lobby-wrap {\n  display: grid;\n  grid-template-columns: 180px minmax(0, 1fr);\n  gap: 30px;\n  width: min(100% - 40px, 1040px);\n  margin: 0 auto;\n  padding: 90px 0 100px;\n}",
    ".lobby-wrap {\n  width: min(100% - 40px, 1040px);\n  margin: 0 auto;\n  padding: 90px 0 100px;\n}",
    "lobby layout",
)
one(".form-heading h3 { margin: 7px 0 0;", ".form-heading h3 { margin: 0;", "form heading")
one(
    ".sealed-bounty-face { position: relative; z-index: 2; display: grid; height: 268px; align-content: space-between; padding: 22px; border: 2px solid var(--ink); color: white; background: var(--blue); box-shadow: 10px 10px 0 var(--lime); overflow: hidden; }",
    ".sealed-bounty-face { position: relative; z-index: 2; display: grid; height: 268px; align-content: space-between; padding: 22px; border: 1px solid var(--ink); color: white; background: var(--blue); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 28%), 7px 7px 0 var(--lime); overflow: hidden; }",
    "bounty face border",
)
one(
    ".sealed-bounty > i { position: absolute; z-index: 1; right: -12px; bottom: 2px; width: 100%; height: 268px; border: 1px solid var(--line-strong); }",
    ".sealed-bounty > i { position: absolute; z-index: 1; right: -7px; bottom: 7px; width: 100%; height: 268px; border: 1px solid var(--line-strong); }",
    "bounty back border",
)
one(
    ".receipt-statement, .audit-transcript, .protocol-section { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 30px; width: min(100% - 40px, 1040px); margin: 0 auto; padding: 82px 0; border-bottom: 1px solid var(--line-strong); }",
    ".receipt-statement, .audit-transcript { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 30px; width: min(100% - 40px, 1040px); margin: 0 auto; padding: 82px 0; border-bottom: 1px solid var(--line-strong); }\n.protocol-section { width: min(100% - 40px, 1040px); margin: 0 auto; padding: 72px 0; border-bottom: 1px solid var(--line-strong); }",
    "protocol layout",
)
one(".protocol-section { align-items: start; }", ".protocol-section { display: block; }", "protocol block")
one(
    "  .lobby-wrap, .receipt-statement, .audit-transcript, .protocol-section { grid-template-columns: 130px minmax(0, 1fr); }",
    "  .receipt-statement, .audit-transcript { grid-template-columns: 130px minmax(0, 1fr); }",
    "tablet protocol grid",
)
one(
    "  .lobby-wrap, .receipt-statement, .audit-transcript, .protocol-section { display: block; width: min(100% - 32px, 1040px); padding: 58px 0; }",
    "  .lobby-wrap, .protocol-section { width: min(100% - 32px, 1040px); padding: 58px 0; }\n  .receipt-statement, .audit-transcript { display: block; width: min(100% - 32px, 1040px); padding: 58px 0; }",
    "mobile section layout",
)
one(
    "  .lobby-wrap > .section-index, .receipt-statement > .section-index, .audit-transcript > .section-index, .protocol-section > .section-index { margin-bottom: 24px; }",
    "  .receipt-statement > .section-index, .audit-transcript > .section-index { margin-bottom: 24px; }",
    "mobile section index",
)

extra = '''
.site-footer {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 28px;
  width: min(100% - 40px, 1120px);
  margin: 0 auto;
  padding: 30px 0 42px;
  border-top: 1px solid var(--line-strong);
}
.site-footer > div { display: grid; gap: 6px; }
.site-footer span, .protocol-stack dt {
  color: var(--blue);
  font-family: "Courier New", monospace;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
}
.site-footer > div > a { font-family: Georgia, "Times New Roman", serif; font-size: 20px; text-decoration: none; }
.site-footer nav { display: flex; gap: 22px; }
.site-footer nav a { color: var(--blue); font-size: 12px; font-weight: 700; text-underline-offset: 3px; }
.protocol-stack { margin: 30px 0 0; border-top: 1px solid var(--line-strong); }
.protocol-stack > div { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 20px; padding: 11px 0; border-bottom: 1px solid var(--line); }
.protocol-stack dt { margin: 0; }
.protocol-stack dd { overflow-wrap: anywhere; margin: 0; font-family: "Courier New", monospace; font-size: 10px; }
.protocol-list { display: grid; gap: 10px; max-width: 790px; margin: 26px 0 0; padding-left: 20px; color: #505760; font-size: 15px; line-height: 1.6; }
.verifier-commands h3 { margin: 32px 0 8px; font-family: Georgia, "Times New Roman", serif; font-size: 22px; font-weight: 500; }
'''
marker = "\n@keyframes hero-card-one"
if css.count(marker) != 1:
    raise RuntimeError("keyframe marker missing")
css = css.replace(marker, extra + marker, 1)

mobile = (
    "  .site-footer { display: block; width: calc(100% - 32px); }\n"
    "  .site-footer nav { margin-top: 18px; }\n"
    "  .protocol-stack > div { grid-template-columns: 1fr; gap: 5px; }\n"
)
marker = "  .site-header { height: auto; min-height: 62px; gap: 12px; padding: 12px 16px; }\n"
if css.count(marker) != 1:
    raise RuntimeError("mobile marker missing")
css = css.replace(marker, marker + mobile, 1)
css_path.write_text(css)

main_path = Path("apps/server/src/main.rs")
main = main_path.read_text()


def main_one(old: str, new: str, label: str) -> None:
    global main
    count = main.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match found {count}")
    main = main.replace(old, new, 1)


main_one("use tower_http::cors::CorsLayer;", "use tower_http::cors::{AllowOrigin, CorsLayer};", "cors import")
main_one(
    '    let origin: HeaderValue = env::var("WEB_ORIGIN")\n        .unwrap_or_else(|_| "http://localhost:3000".to_owned())\n        .parse()?;',
    "    let origins = web_origins()?;",
    "web origin env",
)
main_one(
    "    axum::serve(listener, app(AppState::new(db, rooms, proof), origin)).await?;",
    "    axum::serve(\n        listener,\n        app_with_origins(AppState::new(db, rooms, proof), origins),\n    )\n    .await?;",
    "serve app",
)
main_one(
    "fn app(state: AppState, origin: HeaderValue) -> Router {",
    "#[cfg(test)]\nfn app(state: AppState, origin: HeaderValue) -> Router {\n    app_with_origins(state, vec![origin])\n}\n\nfn app_with_origins(state: AppState, origins: Vec<HeaderValue>) -> Router {",
    "app function",
)
main_one("                .allow_origin(origin)", "                .allow_origin(AllowOrigin::list(origins))", "cors origin")
helper = '''
fn web_origins() -> Result<Vec<HeaderValue>, Box<dyn std::error::Error + Send + Sync>> {
    let raw = env::var("WEB_ORIGINS")
        .or_else(|_| env::var("WEB_ORIGIN"))
        .unwrap_or_else(|_| "http://localhost:3000".to_owned());
    let origins = raw
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(str::parse)
        .collect::<Result<Vec<HeaderValue>, _>>()?;

    if origins.is_empty() {
        return Err(io::Error::other("WEB_ORIGINS empty").into());
    }

    Ok(origins)
}

'''
marker = "async fn health() -> &'static str {"
if main.count(marker) != 1:
    raise RuntimeError("health marker missing")
main = main.replace(marker, helper + marker, 1)
main_path.write_text(main)
