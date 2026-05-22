*** Settings ***
Library    Browser

*** Test Cases ***
Recorded Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    Click    css=#editable-cell    clickCount=2
    # xlib:step=1
    Close Browser
