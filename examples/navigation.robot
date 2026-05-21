*** Settings ***
Library    Browser

*** Test Cases ***
Navigation And History
    New Browser    chromium    headless=${False}    args=["--start-maximized"]
    New Context    viewport=None
    New Page    https://example.com

    Get Text    role=heading[level=1]    *=    Welcome

    Click    role=link[name="About"]
    Get Text    role=heading[level=1]    ==    About Us

    Go Back
    Get Text    role=heading[level=1]    *=    Welcome

    Go Forward
    Get Text    role=heading[level=1]    ==    About Us

    Reload
    Get Element States    role=heading[level=1]    *=    visible

    Close Browser
