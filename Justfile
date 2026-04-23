set dotenv-load

api := env_var_or_default("DITTO_API_BASE", "https://api.heyditto.ai")
npm_cache := env_var_or_default("NPM_CONFIG_CACHE", "/tmp/heyditto-npm-cache")

default:
  @just --list

install:
  npm install

check:
  npm run check

build:
  npm run build

pack: build
  NPM_CONFIG_CACHE="{{npm_cache}}" npm pack --dry-run

config api=api: build
  DITTO_API_BASE="{{api}}" node dist/cli.js config

status api=api: build
  DITTO_API_BASE="{{api}}" node dist/cli.js status

login api=api: build
  DITTO_API_BASE="{{api}}" node dist/cli.js login

logout: build
  node dist/cli.js logout

stdio api=api: build
  DITTO_API_BASE="{{api}}" node dist/cli.js stdio

local-status:
  just status http://localhost:3400

local-login:
  just login http://localhost:3400

local-stdio:
  just stdio http://localhost:3400

verify: check build pack
