*** Settings ***
Library    Browser

*** Test Cases ***
Recorded Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    Get Text    css=#heading    ==    Welcome
    # xlib:step=1
    Close Browser
