*** Settings ***
Library    Browser

*** Test Cases ***
Recorded Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    # TODO: assertSnapshot not supported — ariaSnapshot: - heading "Welcome" [level=1]\n- button "Submit"
    Close Browser
