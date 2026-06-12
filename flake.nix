{
  description = "Multica — managed agents platform. CLI/daemon package + dev shell.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        version = self.shortRev or self.dirtyShortRev or "dev";
      in
      {
        packages = {
          multica = pkgs.buildGoModule {
            pname = "multica";
            inherit version;
            src = ./server;
            subPackages = [ "cmd/multica" ];
            vendorHash = "sha256-NXdBykPMWDD4BGLo2ams+KC14mxGNJYoV/dqobH6dv8=";
            ldflags = [
              "-s"
              "-w"
              "-X main.version=${version}"
              "-X main.commit=${version}"
            ];
            # Tests need postgres; run via `make test` instead.
            doCheck = false;
            meta = with pkgs.lib; {
              description = "Multica CLI + local agent daemon";
              homepage = "https://github.com/multica-ai/multica";
              mainProgram = "multica";
            };
          };
          default = self.packages.${system}.multica;
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            go # needs >= 1.26.1 (server/go.mod)
            gopls
            sqlc
            nodejs_22
            pnpm
            postgresql_17
          ];
        };
      });
}
