*** Settings ***
Library    Browser

*** Test Cases ***
Recorded Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    Check Checkbox    css=#agree-terms
    # xlib:step=1
    Close Browser
