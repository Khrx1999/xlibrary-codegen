*** Settings ***
Library    Browser

*** Test Cases ***
Recorded Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    Get Property    css=#email-input    value    ==    user@example.com
    # xlib:step=1
    Close Browser
