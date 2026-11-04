# Snapsec TaskTracker Firestore Security Specification

## 1. Data Invariants
1. **Default Deny**: All unmatched paths in Firestore are unconditionally denied for both read and write.
2. **Owner-Isolated PII (`/users/{userId}`)**: A user profile contains PII (`email`, `name`, `photoURL`) and can only be read (`get`), created, or updated by the authenticated user whose `request.auth.uid == userId` and `request.auth.token.email_verified == true`.
3. **Immutable Identity & Role Integrity**: `uid`, `email`, `role`, and `createdAt` cannot be forged or escalated during updates; `uid` must strictly equal `request.auth.uid`, and `email` must strictly equal `request.auth.token.email`.
4. **Strict Temporal Integrity**: `createdAt` must equal `request.time` on `create`, remain immutable on `update`, and `updatedAt` must equal `request.time` on every write.
5. **Bounded Strings & Strict Keys**: Every string is bounded by `maxLength`, and `hasAll` / `hasOnly` / `affectedKeys().hasOnly()` prevent shadow fields.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Read**: `get /users/user_1` with `auth = null` -> `PERMISSION_DENIED`
2. **Cross-User PII Read**: `get /users/user_2` with `auth.uid = "user_1"` -> `PERMISSION_DENIED`
3. **Unverified Email Write**: `create /users/user_1` with `email_verified = false` -> `PERMISSION_DENIED`
4. **UID Spoofing**: `create /users/user_1` where `data.uid = "user_2"` -> `PERMISSION_DENIED`
5. **Email Spoofing**: `create /users/user_1` where `data.email != request.auth.token.email` -> `PERMISSION_DENIED`
6. **Shadow Field Injection on Create**: `create /users/user_1` with extra field `isAdmin: true` -> `PERMISSION_DENIED`
7. **Shadow Field Injection on Update**: `update /users/user_1` adding `secret: "x"` -> `PERMISSION_DENIED`
8. **Role Escalation on Update**: `update /users/user_1` changing `role` from `"Member"` to `"Owner"` -> `PERMISSION_DENIED`
9. **Oversized Name Payload**: `create /users/user_1` with `name` of 500 chars (> 120) -> `PERMISSION_DENIED`
10. **Forged Client Timestamp on Create**: `create /users/user_1` with `createdAt != request.time` -> `PERMISSION_DENIED`
11. **Mutating Immutable `createdAt` on Update**: `update /users/user_1` changing `createdAt` -> `PERMISSION_DENIED`
12. **Invalid Path ID Poisoning**: `get /users/invalid$id!` -> `PERMISSION_DENIED`
