*** Settings ***
Library    Browser

*** Test Cases ***
Login Flow
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    https://example.com/login

    Fill Text    role=textbox[name="Email"]    user@example.com
    Fill Text    role=textbox[name="Password"]    supersecret
    Click    role=button[name="Sign in"]

    Get Text    role=heading[level=1]    ==    Dashboard
    Get Element States    role=link[name="Logout"]    *=    visible
    Close Browser
