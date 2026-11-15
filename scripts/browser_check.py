"""Optional real-browser qualification. Requires a provisioned Playwright browser.

Only fictional local files are used. This test is separate from the Node DOM
double and must be recorded as NOT_RUN if the browser cannot start.
"""

import argparse
import io
import json
from pathlib import Path
import tempfile
import zipfile

from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", choices=["chrome", "msedge"])
    parser.add_argument("--browser-executable")
    options = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="porter-browser-") as temporary:
        temp = Path(temporary)
        with sync_playwright() as playwright:
            launch = {"headless": True}
            if options.channel:
                launch["channel"] = options.channel
            if options.browser_executable:
                launch["executable_path"] = options.browser_executable
            browser = playwright.chromium.launch(**launch)
            context = browser.new_context(accept_downloads=True, offline=True)
            page = context.new_page()
            errors = []
            remote_requests = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: remote_requests.append(request.url)
                    if request.url.startswith(("http:", "https:")) else None)
            page.goto((root / "index.html").as_uri())
            page.locator("#demo-button").click()
            expect(page.locator("#stat-transactions")).to_have_text("7")
            expect(page.locator("#summary-rows")).to_have_text("8")
            expect(page.locator("#download-button")).to_be_disabled()
            page.locator("#export-confirm").check()
            with page.expect_download() as pending:
                page.locator("#download-button").click()
            download = pending.value
            output = temp / "fictional-kit.zip"
            download.save_as(output)
            with zipfile.ZipFile(io.BytesIO(output.read_bytes())) as kit:
                assert kit.testzip() is None
                report = json.loads(kit.read("migration-report.json"))
                assert report["summary"]["sourceNet"] == "2408.57"
                assert report["summary"]["exportNet"] == "2408.57"
                canonical = kit.read("portable-book.json")
            page.locator("#target-select").select_option("ynab")
            expect(page.locator("#export-confirm")).not_to_be_checked()
            expect(page.locator("#download-button")).to_be_disabled()
            page.locator("#clear-button").click()
            expect(page.locator("#review-content")).not_to_be_visible()
            assert page.locator("#transactions-body tr").count() == 0

            archive = temp / "portable-book.json"
            archive.write_bytes(canonical)
            page.locator("#encoding").select_option("windows-1252")
            expect(page.locator("#source-file")).to_be_enabled()
            page.locator("#source-file").set_input_files(archive)
            expect(page.locator("#file-title")).to_have_text(archive.name)
            page.locator("#currency-confirm").check()
            page.locator("#read-button").click()
            # A hidden counter can still contain the previous preview's value.
            # Wait for this read to finish before asserting it or selecting a new file.
            expect(page.locator("#read-button")).to_have_attribute("aria-busy", "false")
            expect(page.locator("#review-content")).to_be_visible()
            expect(page.locator("#stat-transactions")).to_have_text("7")
            expect(page.locator("#app-error")).not_to_be_visible()

            broken = temp / "fictional-broken.qif"
            broken.write_text("!Type:Bank\nD2/30/2026\nT-10.00\nPExample\n^\n", encoding="utf-8")
            expect(page.locator("#source-file")).to_be_enabled()
            page.locator("#source-file").set_input_files(broken)
            expect(page.locator("#file-title")).to_have_text(broken.name)
            page.locator("#currency-confirm").check()
            page.locator("#read-button").click()
            expect(page.locator("#read-button")).to_have_attribute("aria-busy", "false")
            expect(page.locator("#export-blocked")).to_be_visible()
            expect(page.locator("#download-button")).to_be_disabled()
            page.locator("#target-select").select_option("archive")
            page.locator("#export-confirm").check()
            expect(page.locator("#download-button")).to_be_enabled()
            assert not errors, errors
            assert not remote_requests, remote_requests
            print(json.dumps({"browser": browser.version, "offline": True,
                              "checks": "demo, ZIP integrity, counts/totals, acknowledgement reset, clear, archive reload, invalid-source blocking",
                              "result": "PASS"}))
            browser.close()


if __name__ == "__main__":
    main()
