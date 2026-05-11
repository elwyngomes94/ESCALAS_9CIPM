# Security Specification - Escalas Extras 9ª CIPM

## 1. Data Invariants
- `policemen`: matricula must be unique (checked in app, but rules enforce matricula type/size).
- `volunteers`: `cotas` must be between 1 and 12.
- `escalas`: `policemenIds` must be a list of non-empty strings.
- `serviceTypes`: `tipo` must be 'PJES' or 'OPS'.
- `users`: `isAdmin` can only be set by an existing admin.

## 2. The "Dirty Dozen" Payloads

1. **Identity Spoofing (Policemen):** A non-admin user attempts to create a policeman.
   `{ "nomeCompleto": "Fake PM", "nomeGuerra": "Fake", "matricula": "123456" }`
2. **Resource Poisoning (Policemen ID):** Attempting to create a policeman with a huge ID string.
3. **Ghost Field Update:** Adding `isAdmin: true` to a user document via a client update.
4. **Cota Overflow:** Setting `cotas` to 100.
   `{ "policemanId": "abc", "type": "PJES", "cotas": 100 }`
5. **State Shortcutting:** Updating an escala date to the past.
6. **Orphaned Record:** Creating an escala with a non-existent `serviceTypeId`.
7. **PII Leak:** Attempting to read the `users` collection as an unauthenticated user.
8. **Invalid Enum:** Setting `serviceType.tipo` to "EXTRA".
9. **Timestamp Fraud:** Providing a client-side `createdAt` set to year 2099.
10. **Shadow Field:** Adding `isVerified: true` to a policeman record.
11. **Bulk Delete:** Attempting to delete all escalas as a common user.
12. **ID Poisoning (Path):** Injecting 2KB string as `policemanId` in the path.

## 3. Test Runner Concept (Handled in rules evaluation)
The rules will explicitly fail these payloads via:
- `isAdmin()` helper.
- `isValidId()` for path and field IDs.
- `isValidPoliceman()`, `isValidServiceType()`, etc. with exact key count and type checks.
- `hasOnly()` on updates.
