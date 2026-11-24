"""Optional real-browser qualification. Requires a provisioned Playwright browser.

Only fictional local files are used. This test is separate from the Node DOM
double and must be recorded as NOT_RUN if the browser cannot start.
"""

import argparse
import csv
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

            # Fully fictional account catalogue: one unknown control-coded type,
            # followed by an explicit, different transaction account. The JSON
            # fixture escapes SOH; selecting this physical QIF exercises decoding.
            soh_source = json.loads((root / "test/fixtures/account-type-source.json").read_text(encoding="utf-8"))["source"]
            soh_file = temp / "fictional-account-type.qif"
            soh_file.write_bytes(soh_source.encode("utf-8"))
            page.locator("#clear-button").click()
            page.locator("#encoding").select_option("utf-8")
            expect(page.locator("#source-file")).to_be_enabled()
            page.locator("#source-file").set_input_files(soh_file)
            expect(page.locator("#file-title")).to_have_text(soh_file.name)
            page.locator("#currency-confirm").check()
            page.locator("#read-button").click()
            expect(page.locator("#read-button")).to_have_attribute("aria-busy", "false")
            expect(page.locator("#review-content")).to_be_visible()
            expect(page.locator("#app-error")).not_to_be_visible()
            expect(page.locator("#stat-transactions")).to_have_text("2")
            expect(page.locator("#summary-rows")).to_have_text("3")
            expect(page.locator("#download-button")).to_be_disabled()
            assert "\x01" not in page.locator("#accounts-body").inner_text()
            page.locator("#target-select").select_option("simplifi")
            page.locator("#export-confirm").check()
            with page.expect_download() as pending:
                page.locator("#download-button").click()
            soh_output = temp / "fictional-account-type-kit.zip"
            pending.value.save_as(soh_output)
            with zipfile.ZipFile(io.BytesIO(soh_output.read_bytes())) as kit:
                assert kit.testzip() is None
                assert kit.read("original-source/source-1.qif") == soh_source.encode("utf-8")
                soh_canonical = kit.read("portable-book.json")
                soh_book = json.loads(soh_canonical)
                assert soh_book["sources"][0]["text"] == soh_source
                assert [(a["name"], a["type"]) for a in soh_book["accounts"]] == [
                    ("Fictional Checking", "Bank"), ("Fictional Legacy", "")]
                assert soh_book["accounts"][1]["rawFields"][1] == "T\x01"
                assert [(t["accountId"], t["amount"]) for t in soh_book["transactions"]] == [
                    ("account-1", "120.50"), ("account-1", "-30.00")]
                soh_notes = [i for i in soh_book["issues"] if i["code"] == "ACCOUNT_TYPE_UNSPECIFIED"]
                assert len(soh_notes) == 1 and soh_notes[0]["severity"] == "warning"
                assert not any(i["severity"] == "error" for i in soh_book["issues"])
                import_files = [name for name in kit.namelist() if name.startswith("import/")]
                assert len(import_files) == 1
                rows = list(csv.DictReader(io.StringIO(kit.read(import_files[0]).decode("utf-8"))))
                assert [row["Amount"] for row in rows] == ["120.50", "-20.00", "-10.00"]
                for name in kit.namelist():
                    if name.endswith(".csv"):
                        assert b"\x01" not in kit.read(name)
                report = json.loads(kit.read("migration-report.json"))
                assert report["summary"]["sourceTransactions"] == 2
                assert report["summary"]["exportedRows"] == 3
                assert report["summary"]["sourceNet"] == "90.50"
                assert report["summary"]["exportNet"] == "90.50"
            expect(page.locator("#issues-list")).to_contain_text(soh_notes[0]["message"])
            assert soh_file.read_bytes() == soh_source.encode("utf-8")

            # Reload and download the generated canonical archive through the UI.
            # A previous Windows-1252 choice must not affect JSON decoding.
            page.locator("#clear-button").click()
            soh_archive = temp / "fictional-account-type-book.json"
            soh_archive.write_bytes(soh_canonical)
            page.locator("#encoding").select_option("windows-1252")
            expect(page.locator("#source-file")).to_be_enabled()
            page.locator("#source-file").set_input_files(soh_archive)
            expect(page.locator("#file-title")).to_have_text(soh_archive.name)
            page.locator("#currency-confirm").check()
            page.locator("#read-button").click()
            expect(page.locator("#read-button")).to_have_attribute("aria-busy", "false")
            expect(page.locator("#review-content")).to_be_visible()
            expect(page.locator("#app-error")).not_to_be_visible()
            expect(page.locator("#stat-transactions")).to_have_text("2")
            expect(page.locator("#summary-rows")).to_have_text("3")
            expect(page.locator("#issues-list")).to_contain_text(soh_notes[0]["message"])
            expect(page.locator("#download-button")).to_be_disabled()
            page.locator("#target-select").select_option("generic")
            page.locator("#export-confirm").check()
            with page.expect_download() as pending:
                page.locator("#download-button").click()
            reopened_output = temp / "fictional-reopened-account-type.zip"
            pending.value.save_as(reopened_output)
            with zipfile.ZipFile(io.BytesIO(reopened_output.read_bytes())) as kit:
                assert kit.testzip() is None
                assert json.loads(kit.read("portable-book.json")) == soh_book
                assert kit.read("original-source/source-1.qif") == soh_source.encode("utf-8")
                assert json.loads(kit.read("migration-report.json"))["summary"]["exportNet"] == "90.50"

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
                              "checks": "demo, terminal DOS EOF physical file, SOH account catalogue physical file, explicit account assignment, exact source preservation, ZIP integrity, counts/totals, acknowledgement reset, clear, EOF/SOH archive reload, private control diagnostics, invalid-source blocking",
                              "result": "PASS"}))
            browser.close()


if __name__ == "__main__":
    main()
