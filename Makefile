SHELL := /bin/bash

WEB_DIR := .
PAGES_BASE_PATH ?= /kata-go-sai/
PREVIEW_HOST ?= 127.0.0.1
PREVIEW_PORT ?= 4173

.PHONY: help install dev test verify-model build preview pages-build clean

help:
	@printf '%s\n' \
		'Available targets:' \
		'  make install      # Install exact npm dependencies' \
		'  make dev          # Start the Vite development server' \
		'  make test         # Run the rules test suite' \
		'  make verify-model # Verify the bundled KataGo model assets' \
		'  make build        # Type-check and build the production app' \
		'  make preview      # Preview the production bundle' \
		'  make pages-build  # Build with the GitHub Pages base path' \
		'  make clean        # Remove generated frontend output'

install:
	npm ci

dev:
	npm run dev

test:
	npm test

verify-model:
	npm run verify:model

build:
	npm run build

preview:
	npm run preview -- --host $(PREVIEW_HOST) --port $(PREVIEW_PORT)

pages-build:
	npm run verify:model
	VITE_BASE_PATH=$(PAGES_BASE_PATH) npm run build

clean:
	rm -rf dist coverage
