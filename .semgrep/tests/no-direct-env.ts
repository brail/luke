function bad() {
  // ruleid: luke-no-direct-env
  const dbUrl = process.env.SOME_APP_SECRET;
  return dbUrl;
}

function goodNextPublic() {
  // ok: luke-no-direct-env
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  return version;
}

function goodNodeEnv() {
  // ok: luke-no-direct-env
  const isDev = process.env.NODE_ENV === 'development';
  return isDev;
}
