*** Settings ***
Library    Browser

*** Test Cases ***
Recorded Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    Uncheck Checkbox    css=#subscribe
    # xlib:step=1
    Close Browser
