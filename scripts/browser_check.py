"""Optional real-browser qualification. Requires a provisioned Playwright browser.

Only fictional local files are used. This test is separate from the Node DOM
double and must be recorded as NOT_RUN if the browser cannot start.
"""

import argparse
import io
import json
from pathlib import Path
import re
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
            expect(page.locator("#read-button")).to_have_attribute("aria-busy", "false")
            expect(page.locator("#review-content")).to_be_visible()
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
                demo_book = json.loads(kit.read("portable-book.json"))
            page.locator("#target-select").select_option("ynab")
            expect(page.locator("#export-confirm")).not_to_be_checked()
            expect(page.locator("#download-button")).to_be_disabled()
            page.locator("#clear-button").click()
            expect(page.locator("#review-content")).not_to_be_visible()
            assert page.locator("#transactions-body tr").count() == 0

            # Use bytes so Windows cannot translate the deliberate CRLF fixture.
            # This is a physical file selected through the same input as a user QIF.
            eof_source = demo_book["sources"][0]["text"].replace("\r\n", "\n").replace("\r", "\n")
            eof_source = eof_source.replace("\n", "\r\n") + "\t \x1a \t\r\n"
            eof_file = temp / "fictional-crlf-eof.qif"
            eof_file.write_bytes(eof_source.encode("utf-8"))
            expect(page.locator("#source-file")).to_be_enabled()
            page.locator("#source-file").set_input_files(eof_file)
            expect(page.locator("#file-title")).to_have_text(eof_file.name)
            page.locator("#currency-confirm").check()
            page.locator("#read-button").click()
            expect(page.locator("#read-button")).to_have_attribute("aria-busy", "false")
            expect(page.locator("#review-content")).to_be_visible()
            expect(page.locator("#app-error")).not_to_be_visible()
            expect(page.locator("#stat-transactions")).to_have_text("7")
            expect(page.locator("#summary-rows")).to_have_text("8")
            expect(page.locator("#download-button")).to_be_disabled()
            page.locator("#target-select").select_option("simplifi")
            page.locator("#export-confirm").check()
            with page.expect_download() as pending:
                page.locator("#download-button").click()
            eof_output = temp / "fictional-eof-kit.zip"
            pending.value.save_as(eof_output)
            with zipfile.ZipFile(io.BytesIO(eof_output.read_bytes())) as kit:
                assert kit.testzip() is None
                assert kit.read("original-source/source-1.qif").decode("utf-8") == eof_source
                canonical = kit.read("portable-book.json")
                eof_book = json.loads(canonical)
                assert eof_book["sources"][0]["text"] == eof_source
                assert eof_book["transactions"] == demo_book["transactions"]
                assert eof_book["accounts"] == demo_book["accounts"]
                eof_notes = [issue for issue in eof_book["issues"] if issue["code"] == "LEGACY_DOS_EOF"]
                assert len(eof_notes) == 1
                assert eof_notes[0]["severity"] in ("info", "warning")
                assert not any(issue["severity"] == "error" for issue in eof_book["issues"])
                report = json.loads(kit.read("migration-report.json"))
                assert report["summary"]["sourceTransactions"] == 7
                assert report["summary"]["exportedRows"] == 8
                assert report["summary"]["sourceNet"] == "2408.57"
                assert report["summary"]["exportNet"] == "2408.57"
                assert eof_notes[0] in report["sourceIssues"]
            expect(page.locator("#issues-list")).to_contain_text(eof_notes[0]["message"])
            page.locator("#clear-button").click()
            expect(page.locator("#review-content")).not_to_be_visible()
            assert page.locator("#transactions-body tr").count() == 0

            # Reload the EOF archive, preserving its exact decoded QIF source.
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
            expect(page.locator("#summary-rows")).to_have_text("8")
            expect(page.locator("#issues-list")).to_contain_text(eof_notes[0]["message"])
            expect(page.locator("#app-error")).not_to_be_visible()
            expect(page.locator("#export-blocked")).not_to_be_visible()
            expect(page.locator("#download-button")).to_be_disabled()

            control_file = temp / "fictional-private-control.qif"
            control_source = ("!Type:Bank\r\nD10/1/2026\r\nT-12.34\r\n"
                              "PPrivate Fixture Payee\r\nM\x1bPrivate Fixture Memo\r\n^\r\n")
            control_file.write_bytes(control_source.encode("utf-8"))
            expect(page.locator("#source-file")).to_be_enabled()
            page.locator("#source-file").set_input_files(control_file)
            expect(page.locator("#file-title")).to_have_text(control_file.name)
            page.locator("#currency-confirm").check()
            page.locator("#read-button").click()
            expect(page.locator("#read-button")).to_have_attribute("aria-busy", "false")
            expect(page.locator("#app-error")).to_be_visible()
            expect(page.locator("#app-error")).to_contain_text("U+001B")
            expect(page.locator("#app-error")).to_contain_text(re.compile(r"line\s+5\b", re.IGNORECASE))
            expect(page.locator("#app-error")).to_contain_text(re.compile(r"column\s+2\b", re.IGNORECASE))
            diagnostic = page.locator("#app-error").inner_text()
            assert not any(value in diagnostic for value in (
                "Private Fixture", "12.34", "10/1/2026", control_file.name))
            expect(page.locator("#review-content")).not_to_be_visible()
            assert page.locator("#transactions-body tr").count() == 0
            expect(page.locator("#download-button")).to_be_disabled()

            broken = temp / "fictional-broken.qif"
            broken.write_text("!Type:Bank\nD2/30/2026\nT-10.00\nPExample\n^\n", encoding="utf-8")
            expect(page.locator("#source-file")).to_be_enabled()
            page.locator("#source-file").set_input_files(broken)
            expect(page.locator("#file-title")).to_have_text(broken.name)
            page.locator("#currency-confirm").check()
            page.locator("#read-button").click()
            expect(page.locator("#read-button")).to_have_attribute("aria-busy", "false")
            expect(page.locator("#review-content")).to_be_visible()
            expect(page.locator("#app-error")).not_to_be_visible()
            expect(page.locator("#export-blocked")).to_be_visible()
            expect(page.locator("#download-button")).to_be_disabled()
            page.locator("#target-select").select_option("archive")
            page.locator("#export-confirm").check()
            expect(page.locator("#download-button")).to_be_enabled()
            assert not errors, errors
            assert not remote_requests, remote_requests
            print(json.dumps({"browser": browser.version, "offline": True,
                              "checks": "demo, terminal DOS EOF physical file, exact source preservation, ZIP integrity, counts/totals, acknowledgement reset, clear, EOF archive reload, private control diagnostics, invalid-source blocking",
                              "result": "PASS"}))
            browser.close()


if __name__ == "__main__":
    main()
