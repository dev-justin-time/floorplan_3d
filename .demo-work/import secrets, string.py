import secrets, string
charset = string.ascii_letters + string.digits
print(secrets.token_urlsafe(49))  # or:
print(''.join(secrets.choice(charset) for _ in range(49)))   