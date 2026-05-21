*** Settings ***
Library    Browser

*** Test Cases ***
Form Submission
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    https://example.com/register

    Fill Text    role=textbox[name="First Name"]    Alice
    Fill Text    role=textbox[name="Last Name"]     Smith
    Fill Text    label=Email address                alice@example.com

    Select Options By    role=combobox[name="Country"]    text    Australia

    Check Checkbox    role=checkbox[name="I agree to the terms and conditions"]

    Upload File By Selector    css=input[type="file"]    ${CURDIR}/fixtures/avatar.png

    Click    role=button[name="Create Account"]

    Get Text    role=heading[level=1]    ==    Account Created
    Get Property    role=textbox[name="Email"]    value    ==    alice@example.com
    Close Browser
