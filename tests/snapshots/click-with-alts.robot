*** Settings ***
Library    Browser

*** Test Cases ***
Recorded Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    Click    role=button[name="Sign In"]
    # xlib:step=1;alts=["[data-testid=\"submit\"]","internal:text=\"Sign In\"","css=#login-btn"]
    Close Browser
