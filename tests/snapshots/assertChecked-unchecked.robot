*** Settings ***
Library    Browser

*** Test Cases ***
Recorded Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    Get Checkbox State    css=#marketing-opt-out    ==    unchecked
    # xlib:step=1
    Close Browser
