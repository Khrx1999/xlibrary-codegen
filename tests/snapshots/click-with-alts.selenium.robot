*** Settings ***
Library    SeleniumLibrary

*** Test Cases ***
Recorded Flow
    Click Element    xpath=//button[normalize-space(.)='Sign In']
    # xlib:step=1;alts=["[data-testid=\"submit\"]","internal:text=\"Sign In\"","css=#login-btn"]
