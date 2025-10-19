from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        # Launch Obsidian
        try:
            browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
        except Exception as e:
            print(f"Error launching browser: {e}")
            return

        # Create a new page
        page = browser.new_page()

        # Give Obsidian time to load
        time.sleep(10)

        try:
            # Open the command palette
            page.keyboard.press("Control+Shift+P")
            time.sleep(1)

            # Type "Notes Explorer" to find the plugin commands
            page.keyboard.type("Notes Explorer")
            time.sleep(1)

            # Open the Notes Explorer view
            page.keyboard.press("Enter")
            time.sleep(2)

            # Open the command palette again
            page.keyboard.press("Control+Shift+P")
            time.sleep(1)

            # Type "Notes Explorer" to find the plugin commands
            page.keyboard.type("Notes Explorer Menu")
            time.sleep(1)

            # Open the Notes Explorer Menu view
            page.keyboard.press("Enter")
            time.sleep(2)

            # Take a screenshot of the entire window
            page.screenshot(path="jules-scratch/verification/verification.png")

        finally:
            # Close the browser
            browser.close()

if __name__ == "__main__":
    run()
