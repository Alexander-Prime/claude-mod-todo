{
  description = "Claude TODO Statusline";

  inputs = {
    nixpkgs.url = "github:NixOs/nixpkgs/nixos-unstable";
    claude-code.url = "github:sadjow/claude-code-nix";
  };

  outputs = { self, nixpkgs, claude-code }: let
    system = "x86_64-linux";
    pkgs = import nixpkgs { system = system; config.allowUnfree = true; };
  in {
    devShell.${system} = pkgs.mkShell {
      buildInputs = with pkgs; [
        claude-code.packages.${system}.default
      ];
    };
  };
}
