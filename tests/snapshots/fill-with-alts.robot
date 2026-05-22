*** Settings ***
Library    Browser

*** Test Cases ***
Recorded Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    Fill Text    label=Email    user@example.com
    # xlib:step=1;alts=["[data-testid=\"email\"]","css=#email-input"]
    Close Browser
