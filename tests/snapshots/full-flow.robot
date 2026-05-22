*** Settings ***
Library    Browser

*** Test Cases ***
Recorded Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    https://example.com/login
    # xlib:step=1
    Fill Text    css=#username    admin
    # xlib:step=2
    Fill Text    css=#password    secret
    # xlib:step=3
    Click    css=#login-btn
    # xlib:step=4
    Get Text    css=#welcome-banner    ==    Welcome admin
    # xlib:step=5
    Close Browser
