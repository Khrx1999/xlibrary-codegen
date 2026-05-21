*** Settings ***
Library    Browser

*** Test Cases ***
Recorded Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    https://example.com/login
    Fill Text    css=#username    admin
    Fill Text    css=#password    secret
    Click    css=#login-btn
    Get Text    css=#welcome-banner    ==    Welcome admin
    Close Browser
