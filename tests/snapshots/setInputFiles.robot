*** Settings ***
Library    Browser

*** Test Cases ***
Recorded Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    Upload File By Selector    css=#file-input    /path/to/upload.pdf
    # xlib:step=1
    Close Browser
