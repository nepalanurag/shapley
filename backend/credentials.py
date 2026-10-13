"""Credential helper: env vars in production, surrogate in local dev."""
import os
import sys
import urllib.request


def _get_surrogate(credential_name, allowed_hosts):
    """Try to get a surrogate token from the local credential system."""
    try:
        sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
        from dynamic_credentials import add_surrogate_to_request
        return add_surrogate_to_request
    except ImportError:
        return None


def auth_request(url, env_name, credential_name, allowed_hosts,
                 data=None, headers=None, method=None):
    """Build a urllib Request with auth from env var or local surrogate.

    In production (Render), uses the env var as a Bearer token.
    In local dev, uses the secure surrogate credential system.
    """
    api_key = os.environ.get(env_name)
    req = urllib.request.Request(url, data=data, headers=headers or {},
                                 method=method)

    if api_key:
        # Production: direct Bearer token
        req.add_header("Authorization", f"Bearer {api_key}")
    elif credential_name:
        # Local dev: surrogate system
        add_surrogate = _get_surrogate(credential_name, allowed_hosts)
        if add_surrogate:
            add_surrogate(req, credential_name, allowed_hosts=allowed_hosts)
    return req
